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
    const { semanticWeight = 0.7, keywordWeight = 0.3 } = options
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

    // Combine scores
    const combined: SearchResult[] = Array.from(results.values()).map(({ node, semanticScore, keywordScore }) => {
      const score = semanticScore * semanticWeight + keywordScore * keywordWeight
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
