import express from 'express'
import { randomBytes, createHash } from 'crypto'
import type { DatabaseService } from '../services/database'
import type { OllamaService } from '../services/ollama'

// Short-lived context tokens: token → { context, expiresAt }
const tokenStore = new Map<string, { context: string; summary: string; expiresAt: number }>()

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

export function startApiServer(db: DatabaseService, ollama: OllamaService, port: number): void {
  const app = express()
  app.use(express.json())

  // CORS for local tools
  app.use((_, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ContextFabric-Token')
    next()
  })
  app.options('*', (_, res) => res.sendStatus(200))

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/health', (_, res) => {
    const stats = db.getStats()
    res.json({ status: 'ok', version: '1.0.0', name: 'ContextFabric', stats })
  })

  // ── GET /api/stats ──────────────────────────────────────────────────────────
  app.get('/api/stats', (_, res) => res.json(db.getStats()))

  // ── GET /api/sources ────────────────────────────────────────────────────────
  app.get('/api/sources', (_, res) => res.json(db.getSources()))

  // ── POST /api/context — getContext(query) ───────────────────────────────────
  // Keyword search across all sources. Lightweight, no Ollama dependency.
  app.post('/api/context', (req, res) => {
    try {
      const { query, limit = 5, sourceIds } = req.body as {
        query: string; limit?: number; sourceIds?: string[]
      }
      if (!query) return res.status(400).json({ error: 'query is required' })

      const nodes = db.getNodes(1000)
      const filtered = sourceIds ? nodes.filter(n => sourceIds.includes(n.sourceId)) : nodes
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)

      const scored = filtered
        .map(node => {
          const text = `${node.title} ${node.content} ${node.entities.join(' ')}`.toLowerCase()
          const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0) / words.length
          return { node, score }
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      return res.json({
        query,
        results: scored.map(r => ({
          content: r.node.content.substring(0, 800),
          source: r.node.sourceName,
          title: r.node.title,
          type: r.node.type,
          timestamp: r.node.timestamp,
          entities: r.node.entities,
          summary: r.node.summary || null,
          score: r.score,
        })),
        total: scored.length,
      })
    } catch (err) {
      return res.status(500).json({ error: String(err) })
    }
  })

  // ── GET /api/memory/project/:sourceId — getProjectMemory(projectId) ─────────
  // Returns all memory nodes for a specific source, with entity and decision summary.
  app.get('/api/memory/project/:sourceId', (req, res) => {
    try {
      const { sourceId } = req.params
      const source = db.getSource(sourceId)
      if (!source) return res.status(404).json({ error: 'Source not found' })

      const nodes = db.getNodesBySource(sourceId)
      const decisions = db.getTimeline(100).filter(e => e.sourceId === sourceId)
      const allEntities = [...new Set(nodes.flatMap(n => n.entities))]

      return res.json({
        source: {
          id: source.id,
          name: source.name,
          type: source.type,
          path: source.path,
          nodeCount: source.nodeCount,
          lastSynced: source.lastSynced,
        },
        nodes: nodes.slice(0, 200).map(n => ({
          id: n.id,
          title: n.title,
          type: n.type,
          summary: n.summary || n.content.substring(0, 150),
          entities: n.entities,
          timestamp: n.timestamp,
        })),
        entities: allEntities.slice(0, 30),
        decisions: decisions.map(d => ({
          title: d.title,
          description: d.description,
          timestamp: d.timestamp,
          significance: d.significance,
        })),
        totalNodes: nodes.length,
      })
    } catch (err) {
      return res.status(500).json({ error: String(err) })
    }
  })

  // ── POST /api/memory/search — searchMemory(semanticQuery) ───────────────────
  // Semantic search using stored embeddings + cosine similarity (no Ollama needed).
  app.post('/api/memory/search', (req, res) => {
    try {
      const { query, limit = 10, sourceIds, semantic = true } = req.body as {
        query: string; limit?: number; sourceIds?: string[]; semantic?: boolean
      }
      if (!query) return res.status(400).json({ error: 'query is required' })

      let results: Array<{ nodeId: string; score: number }> = []

      if (semantic) {
        // Use fast hash embed (no network call) to compute query vector
        const queryEmb = ollama.fastEmbed(query)
        const embeddings = db.getAllEmbeddings()

        results = embeddings
          .map(({ nodeId, embedding }) => ({
            nodeId,
            score: cosineSimilarity(queryEmb, embedding),
          }))
          .filter(r => r.score > 0.1)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit * 2)
      } else {
        // Keyword fallback
        const nodes = db.getNodes(1000)
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
        results = nodes.map(n => ({
          nodeId: n.id,
          score: words.reduce((s, w) =>
            s + (`${n.title} ${n.content}`.toLowerCase().includes(w) ? 1 : 0), 0) / words.length,
        })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit * 2)
      }

      const hits = results
        .map(r => {
          const node = db.getNode(r.nodeId)
          if (!node) return null
          if (sourceIds && !sourceIds.includes(node.sourceId)) return null
          return { node, score: r.score }
        })
        .filter(Boolean)
        .slice(0, limit) as Array<{ node: NonNullable<ReturnType<typeof db.getNode>>; score: number }>

      return res.json({
        query,
        mode: semantic ? 'semantic' : 'keyword',
        results: hits.map(r => ({
          id: r.node.id,
          title: r.node.title,
          content: r.node.content.substring(0, 600),
          summary: r.node.summary || null,
          source: r.node.sourceName,
          sourceId: r.node.sourceId,
          type: r.node.type,
          entities: r.node.entities,
          timestamp: r.node.timestamp,
          score: Math.round(r.score * 1000) / 1000,
        })),
        total: hits.length,
      })
    } catch (err) {
      return res.status(500).json({ error: String(err) })
    }
  })

  // ── GET /api/decisions — getDecisionHistory() ────────────────────────────────
  // Returns all detected decisions from timeline, filterable by source or entity.
  app.get('/api/decisions', (req, res) => {
    try {
      const { sourceId, entity, limit = 50 } = req.query as {
        sourceId?: string; entity?: string; limit?: string
      }

      let decisions = db.getTimeline(Number(limit) || 50)

      if (sourceId) {
        decisions = decisions.filter(d => d.sourceId === sourceId)
      }
      if (entity) {
        const ent = entity.toLowerCase()
        decisions = decisions.filter(d =>
          d.relatedEntities.some(e => e.toLowerCase().includes(ent)) ||
          d.title.toLowerCase().includes(ent)
        )
      }

      return res.json({
        decisions: decisions.map(d => ({
          id: d.id,
          title: d.title,
          description: d.description,
          type: d.type,
          significance: d.significance,
          source: d.sourceName,
          sourceId: d.sourceId,
          relatedEntities: d.relatedEntities,
          timestamp: d.timestamp,
          date: new Date(d.timestamp).toISOString(),
        })),
        total: decisions.length,
      })
    } catch (err) {
      return res.status(500).json({ error: String(err) })
    }
  })

  // ── POST /api/context/inject — injectContext(scope) ──────────────────────────
  // Returns a formatted context block ready to paste into an AI prompt.
  // scope: 'global' | 'project' | 'recent' | 'decisions'
  app.post('/api/context/inject', (req, res) => {
    try {
      const { scope = 'global', sourceId, maxTokens = 2000 } = req.body as {
        scope?: 'global' | 'project' | 'recent' | 'decisions'
        sourceId?: string
        maxTokens?: number
      }

      const charLimit = maxTokens * 4 // rough chars-per-token estimate
      let contextBlock = ''
      let meta = {}

      if (scope === 'decisions') {
        const decisions = db.getTimeline(20)
        contextBlock = `# Decision History\n` +
          decisions.map(d =>
            `- **${d.title}** (${d.sourceName}): ${d.description || ''}`.substring(0, 200)
          ).join('\n')
        meta = { scope, decisionCount: decisions.length }

      } else if (scope === 'project' && sourceId) {
        const source = db.getSource(sourceId)
        const nodes = db.getNodesBySource(sourceId).slice(0, 30)
        contextBlock = `# Project: ${source?.name || sourceId}\n\n` +
          nodes.map(n => `## ${n.title}\n${(n.summary || n.content).substring(0, 300)}`).join('\n\n')
        meta = { scope, sourceId, nodeCount: nodes.length }

      } else if (scope === 'recent') {
        const nodes = db.getNodes(20)
        contextBlock = `# Recent Memory (last ${nodes.length} items)\n\n` +
          nodes.map(n => `- **${n.title}** (${n.sourceName}): ${(n.summary || n.content.substring(0, 150)).replace(/\n/g, ' ')}`).join('\n')
        meta = { scope, nodeCount: nodes.length }

      } else {
        // global — top nodes + entity map + recent decisions
        const nodes = db.getNodes(30)
        const decisions = db.getTimeline(5)
        const entities = db.getEntities(20)

        contextBlock = `# ContextFabric Memory Snapshot\n\n`
        contextBlock += `## Key Technologies\n${entities.map(e => e.name).join(', ')}\n\n`
        contextBlock += `## Recent Decisions\n` +
          decisions.map(d => `- ${d.title}`).join('\n') + '\n\n'
        contextBlock += `## Knowledge Base\n` +
          nodes.slice(0, 15).map(n =>
            `### ${n.title} (${n.sourceName})\n${(n.summary || n.content.substring(0, 200)).replace(/\n/g, ' ')}`
          ).join('\n\n')
        meta = { scope, nodeCount: nodes.length, decisionCount: decisions.length }
      }

      // Trim to token budget
      if (contextBlock.length > charLimit) {
        contextBlock = contextBlock.substring(0, charLimit) + '\n\n[context truncated]'
      }

      return res.json({
        scope,
        context: contextBlock,
        charCount: contextBlock.length,
        estimatedTokens: Math.round(contextBlock.length / 4),
        meta,
      })
    } catch (err) {
      return res.status(500).json({ error: String(err) })
    }
  })

  // ── POST /api/token — exportContextToken() ───────────────────────────────────
  // Generates a short-lived token encoding a context snapshot.
  // Other tools can use GET /api/token/:token to retrieve the context later.
  app.post('/api/token', (req, res) => {
    try {
      const { query, scope = 'global', ttlSeconds = 3600 } = req.body as {
        query?: string; scope?: string; ttlSeconds?: number
      }

      // Build context snapshot
      const nodes = query
        ? (() => {
            const words = query.toLowerCase().split(/\s+/)
            return db.getNodes(500)
              .filter(n => words.some(w => `${n.title} ${n.content}`.toLowerCase().includes(w)))
              .slice(0, 10)
          })()
        : db.getNodes(10)

      const decisions = db.getTimeline(5)
      const summary = nodes.map(n => `${n.title}: ${(n.summary || n.content).substring(0, 100)}`).join('\n')
      const context = [
        query ? `Query context for: "${query}"` : `Global memory snapshot`,
        `Sources: ${[...new Set(nodes.map(n => n.sourceName))].join(', ')}`,
        `\n${summary}`,
        decisions.length > 0 ? `\nKey decisions:\n${decisions.map(d => `- ${d.title}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')

      // Generate token
      const token = randomBytes(24).toString('base64url')
      const expiresAt = Date.now() + ttlSeconds * 1000

      tokenStore.set(token, { context, summary: summary.substring(0, 200), expiresAt })

      // Clean up expired tokens
      for (const [t, v] of tokenStore) {
        if (v.expiresAt < Date.now()) tokenStore.delete(t)
      }

      return res.json({
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        ttlSeconds,
        nodeCount: nodes.length,
        summary: summary.substring(0, 200),
        retrieveUrl: `http://localhost:${port}/api/token/${token}`,
      })
    } catch (err) {
      return res.status(500).json({ error: String(err) })
    }
  })

  // ── GET /api/token/:token — retrieve exported context ───────────────────────
  app.get('/api/token/:token', (req, res) => {
    const entry = tokenStore.get(req.params.token)
    if (!entry) return res.status(404).json({ error: 'Token not found or expired' })
    if (entry.expiresAt < Date.now()) {
      tokenStore.delete(req.params.token)
      return res.status(410).json({ error: 'Token expired' })
    }
    return res.json({
      context: entry.context,
      summary: entry.summary,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    })
  })

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`[API] ContextFabric local API running on port ${port}`)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[API] Port ${port} in use, trying ${port + 1}`)
      server.listen(port + 1, '127.0.0.1')
    }
  })
}
