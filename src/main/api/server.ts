import express from 'express'
import type { DatabaseService } from '../services/database'

export function startApiServer(db: DatabaseService, port: number): void {
  const app = express()
  app.use(express.json())

  // CORS for local tools
  app.use((_, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ContextFabric-Key')
    next()
  })

  // Health check
  app.get('/health', (_, res) => {
    res.json({ status: 'ok', version: '1.0.0', name: 'ContextFabric' })
  })

  // Context retrieval endpoint (for IDE plugins, local AI tools)
  app.post('/api/context', async (req, res) => {
    try {
      const { query, limit = 5, sourceIds } = req.body as {
        query: string
        limit?: number
        sourceIds?: string[]
      }

      if (!query) {
        return res.status(400).json({ error: 'query is required' })
      }

      const nodes = db.getNodes(500)
      const filtered = sourceIds ? nodes.filter(n => sourceIds.includes(n.sourceId)) : nodes

      // Simple keyword match for local API (no ollama dependency)
      const words = query.toLowerCase().split(/\s+/)
      const scored = filtered.map(node => {
        const text = `${node.title} ${node.content} ${node.tags.join(' ')}`.toLowerCase()
        const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0) / words.length
        return { node, score }
      }).filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      return res.json({
        query,
        results: scored.map(r => ({
          content: r.node.content.substring(0, 1000),
          source: r.node.sourceName,
          title: r.node.title,
          timestamp: r.node.timestamp,
          type: r.node.type,
          score: r.score,
        })),
        total: scored.length,
      })
    } catch (err) {
      return res.status(500).json({ error: String(err) })
    }
  })

  // Stats
  app.get('/api/stats', (_, res) => {
    res.json(db.getStats())
  })

  // Sources
  app.get('/api/sources', (_, res) => {
    res.json(db.getSources())
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
