import type { DatabaseService } from './database'
import type { OllamaService } from './ollama'
import type { SearchResult, MemoryNode } from '../../shared/types'

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

// Exponential decay: score = 1 at age=0, ~0.5 at halfLifeDays, approaching 0 asymptotically
function recencyScore(timestampMs: number, halfLifeDays = 180): number {
  const ageDays = (Date.now() - timestampMs) / 86_400_000
  return Math.exp(-ageDays * Math.LN2 / halfLifeDays)
}

// Detect queries that care about time so we can boost recency weight
function isTimeAwareQuery(query: string): boolean {
  return /\b(recent|latest|last|current|today|this week|this month|new|now|just|ago|yesterday)\b/i.test(query)
}

function looksLikeLayoutOrStyles(node: MemoryNode): boolean {
  const text = node.content.slice(0, 1600).toLowerCase()
  const markers = ['display:', 'position:', 'padding:', 'margin:', 'background:', 'border:', 'animation:', 'z-index:', '/*', '</div>']
  return markers.filter(marker => text.includes(marker)).length >= 4
}

function identityScore(node: MemoryNode, query: string): number {
  const words = identityTerms(query)
  if (words.length === 0) return 0
  const phrase = words.join(' ')
  const compact = words.join('')
  const title = node.title.toLowerCase()
  const contentStart = node.content.slice(0, 2000).toLowerCase()
  const compactText = `${title} ${contentStart}`.replace(/[^a-z0-9]/g, '')
  let score = 0
  if (title.includes(phrase)) score += 0.5
  if (title.replace(/[^a-z0-9]/g, '').includes(compact)) score += 0.5
  if (contentStart.includes(phrase)) score += 0.35
  if (compactText.includes(compact)) score += 0.35
  return score
}

function identityTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['could', 'tell', 'know', 'about', 'what', 'please', 'you', 'the', 'can'].includes(w))
}

function hasLiteralIdentityMatch(node: MemoryNode, query: string): boolean {
  const words = identityTerms(query)
  if (words.length === 0) return true
  const compact = words.join('')
  const text = `${node.title} ${node.content.slice(0, 5000)} ${node.entities.join(' ')}`.toLowerCase()
  const compactText = text.replace(/[^a-z0-9]/g, '')
  return words.some(word => text.includes(word)) || Boolean(compact && compactText.includes(compact))
}

export class SearchService {
  constructor(
    private db: DatabaseService,
    private ollama: OllamaService
  ) {}

  async hybridSearch(
    query: string,
    limit = 20,
    options: { semanticWeight?: number; keywordWeight?: number; filterSourceIds?: string[] } = {}
  ): Promise<SearchResult[]> {
    const timeAware = isTimeAwareQuery(query)
    // Time-aware queries: heavy recency boost. Normal queries: light recency nudge.
    const recencyWeight = timeAware ? 0.30 : 0.05
    const { semanticWeight = timeAware ? 0.50 : 0.65, keywordWeight = timeAware ? 0.20 : 0.30 } = options
    const results = new Map<string, { node: MemoryNode; semanticScore: number; keywordScore: number }>()

    // Semantic search
    let queryEmbedding: number[] = []
    try {
      queryEmbedding = await this.ollama.embed(query)
    } catch {
      // fall back to keyword-only
    }

    if (queryEmbedding.length > 0) {
      const allEmbeddings = this.db.getAllEmbeddings()
      const scored: Array<{ nodeId: string; score: number }> = []

      for (const { nodeId, embedding } of allEmbeddings) {
        const score = cosineSimilarity(queryEmbedding, embedding)
        if (score > 0.3) scored.push({ nodeId, score })
      }

      scored.sort((a, b) => b.score - a.score)

      for (const { nodeId, score } of scored.slice(0, limit * 2)) {
        const node = this.db.getNode(nodeId)
        if (!node) continue
        if (options.filterSourceIds && !options.filterSourceIds.includes(node.sourceId)) continue
        results.set(nodeId, { node, semanticScore: score, keywordScore: 0 })
      }
    }

    // Keyword search
    try {
      const kwResults = this.db.keywordSearch(query, limit * 2)
      for (const { node, score } of kwResults) {
        if (options.filterSourceIds && !options.filterSourceIds.includes(node.sourceId)) continue
        const existing = results.get(node.id)
        if (existing) {
          existing.keywordScore = Math.min(score / 10, 1)
        } else {
          results.set(node.id, { node, semanticScore: 0, keywordScore: Math.min(score / 10, 1) })
        }
      }
    } catch {
      // ignore fts errors
    }

    // Combine scores with recency
    const combined: SearchResult[] = Array.from(results.values()).map(({ node, semanticScore, keywordScore }) => {
      const rScore = recencyScore(node.timestamp)
      const idScore = identityScore(node, query)
      const literalMatch = hasLiteralIdentityMatch(node, query)
      const adjustedSemantic = literalMatch ? semanticScore : semanticScore * 0.08
      const noisePenalty = node.type === 'code' && looksLikeLayoutOrStyles(node) ? 0.03 : 1
      const score = (adjustedSemantic * semanticWeight + keywordScore * keywordWeight + idScore + rScore * recencyWeight) * noisePenalty
      return {
        node,
        score,
        highlights: this.extractHighlights(node.content, query),
        sourceContext: `${node.sourceName} · ${new Date(node.timestamp).toLocaleDateString()}`,
      }
    })

    combined.sort((a, b) => b.score - a.score)
    return combined.slice(0, limit)
  }

  private extractHighlights(content: string, query: string): string[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    const sentences = content.split(/[.!?\n]+/).filter(s => s.trim().length > 20)
    const highlights: string[] = []

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase()
      const matchCount = words.filter(w => lower.includes(w)).length
      if (matchCount > 0) {
        highlights.push(sentence.trim().substring(0, 200))
        if (highlights.length >= 3) break
      }
    }

    if (highlights.length === 0 && sentences.length > 0) {
      highlights.push(sentences[0].trim().substring(0, 200))
    }

    return highlights
  }
}
