import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { randomBytes } from 'crypto'
import type { DatabaseService } from '../services/database'
import type { OllamaService } from '../services/ollama'
import { setToken, getToken } from './tokenStore'

// ── Types ────────────────────────────────────────────────────────────────────

interface PermRequest extends Request {
  allowedSourceIds: string[] | null  // null = all sources allowed
  appId: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

function filterByPermissions(ids: string[], allowed: string[] | null): string[] {
  if (allowed === null) return ids
  return ids.filter(id => allowed.includes(id))
}

// ── Permission middleware ─────────────────────────────────────────────────────

function permissionMiddleware(db: DatabaseService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const pr = req as PermRequest

    const appId = ((req.headers['x-contextfabric-app'] as string) || 'external').toLowerCase()
    pr.appId = appId

    const settings = db.getAllSettings()
    const allowedApps = (settings.allowedApps as Record<string, boolean>) || {}
    const appAllowed = allowedApps[appId] ?? (appId !== 'external')

    if (!appAllowed) {
      res.status(403).json({ error: `App "${appId}" is not allowed. Enable it in ContextFabric → Permissions.` })
      return
    }

    const perms = (settings.contextPermissions || {}) as Record<string, {
      allowGlobal: boolean; allowVSCode: boolean; allowExternal: boolean
    }>

    if (Object.keys(perms).length === 0) {
      pr.allowedSourceIds = null
      next()
      return
    }

    pr.allowedSourceIds = Object.entries(perms)
      .filter(([, p]) => {
        if (appId === 'vscode') return p.allowVSCode
        if (appId === 'claude' || appId === 'global') return p.allowGlobal
        return p.allowExternal
      })
      .map(([id]) => id)

    next()
  }
}

// ── Server ───────────────────────────────────────────────────────────────────

export function startApiServer(db: DatabaseService, ollama: OllamaService, port: number): void {
  const app = express()
  app.use(express.json())

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ContextFabric-App, X-ContextFabric-Token')
    next()
  })

  app.options('*', (_req: Request, res: Response) => { res.sendStatus(200) })

  // Use a Router so token retrieval can be registered before permission middleware
  const apiRouter = express.Router()

  // Token retrieval — auth'd by token value, no app header required
  apiRouter.get('/token/:tokenId', (req: Request, res: Response) => {
    const entry = getToken(req.params.tokenId)
    if (!entry) { res.status(404).json({ error: 'Token not found or expired' }); return }
    res.json({ context: entry.context, summary: entry.summary, expiresAt: new Date(entry.expiresAt).toISOString() })
  })

  // All other /api routes require app permission
  apiRouter.use(permissionMiddleware(db))

  app.use('/api', apiRouter)

  // ── GET /health ─────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0', name: 'ContextFabric', stats: db.getStats() })
  })

  // ── GET /api/stats ──────────────────────────────────────────────────────────
  apiRouter.get('/stats', (_req: Request, res: Response) => {
    res.json(db.getStats())
  })

  // ── GET /api/sources ────────────────────────────────────────────────────────
  apiRouter.get('/sources', (req: Request, res: Response) => {
    const pr = req as PermRequest
    const sources = db.getSources()
    const filtered = pr.allowedSourceIds === null
      ? sources
      : sources.filter(s => pr.allowedSourceIds!.includes(s.id))
    res.json(filtered)
  })

  // ── POST /api/context ───────────────────────────────────────────────────────
  apiRouter.post('/context', (req: Request, res: Response) => {
    try {
      const pr = req as PermRequest
      const { query, limit = 5, sourceIds: reqIds } = req.body as {
        query: string; limit?: number; sourceIds?: string[]
      }
      if (!query) { res.status(400).json({ error: 'query is required' }); return }

      const nodes = db.getNodes(1000).filter(n => {
        if (pr.allowedSourceIds !== null && !pr.allowedSourceIds.includes(n.sourceId)) return false
        if (reqIds && !reqIds.includes(n.sourceId)) return false
        return true
      })

      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      const scored = nodes
        .map(node => {
          const text = `${node.title} ${node.content} ${node.entities.join(' ')}`.toLowerCase()
          const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0) / words.length
          return { node, score }
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      res.json({
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
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  // ── GET /api/memory/project/:sourceId ───────────────────────────────────────
  apiRouter.get('/memory/project/:sourceId', (req: Request, res: Response) => {
    try {
      const pr = req as PermRequest
      const { sourceId } = req.params
      if (pr.allowedSourceIds !== null && !pr.allowedSourceIds.includes(sourceId)) {
        res.status(403).json({ error: 'Access to this source is not permitted' }); return
      }
      const source = db.getSource(sourceId)
      if (!source) { res.status(404).json({ error: 'Source not found' }); return }

      const nodes = db.getNodesBySource(sourceId)
      const decisions = db.getTimeline(100).filter(e => e.sourceId === sourceId)
      const allEntities = [...new Set(nodes.flatMap(n => n.entities))]

      res.json({
        source: { id: source.id, name: source.name, type: source.type, path: source.path, nodeCount: source.nodeCount, lastSynced: source.lastSynced },
        nodes: nodes.slice(0, 200).map(n => ({
          id: n.id, title: n.title, type: n.type,
          summary: n.summary || n.content.substring(0, 150),
          entities: n.entities, timestamp: n.timestamp,
        })),
        entities: allEntities.slice(0, 30),
        decisions: decisions.map(d => ({ title: d.title, description: d.description, timestamp: d.timestamp, significance: d.significance })),
        totalNodes: nodes.length,
      })
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  // ── POST /api/memory/search ─────────────────────────────────────────────────
  apiRouter.post('/memory/search', (req: Request, res: Response) => {
    try {
      const pr = req as PermRequest
      const { query, limit = 10, sourceIds: reqIds, semantic = true } = req.body as {
        query: string; limit?: number; sourceIds?: string[]; semantic?: boolean
      }
      if (!query) { res.status(400).json({ error: 'query is required' }); return }

      const effectiveSourceIds: string[] | null = pr.allowedSourceIds === null
        ? (reqIds ?? null)
        : filterByPermissions(reqIds ?? pr.allowedSourceIds, pr.allowedSourceIds)

      let candidates: Array<{ nodeId: string; score: number }> = []

      if (semantic) {
        const queryEmb = ollama.fastEmbed(query)
        candidates = db.getAllEmbeddings()
          .map(({ nodeId, embedding }) => ({ nodeId, score: cosineSimilarity(queryEmb, embedding) }))
          .filter(r => r.score > 0.1)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit * 3)
      } else {
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
        candidates = db.getNodes(1000)
          .map(n => ({
            nodeId: n.id,
            score: words.reduce((s, w) => s + (`${n.title} ${n.content}`.toLowerCase().includes(w) ? 1 : 0), 0) / words.length,
          }))
          .filter(r => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit * 3)
      }

      const hits = candidates
        .map(r => {
          const node = db.getNode(r.nodeId)
          if (!node) return null
          if (effectiveSourceIds !== null && !effectiveSourceIds.includes(node.sourceId)) return null
          return { node, score: r.score }
        })
        .filter((r): r is { node: NonNullable<ReturnType<typeof db.getNode>>; score: number } => r !== null)
        .slice(0, limit)

      res.json({
        query, mode: semantic ? 'semantic' : 'keyword',
        results: hits.map(r => ({
          id: r.node.id, title: r.node.title, content: r.node.content.substring(0, 600),
          summary: r.node.summary || null, source: r.node.sourceName, sourceId: r.node.sourceId,
          type: r.node.type, entities: r.node.entities, timestamp: r.node.timestamp,
          score: Math.round(r.score * 1000) / 1000,
        })),
        total: hits.length,
      })
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  // ── GET /api/decisions ──────────────────────────────────────────────────────
  apiRouter.get('/decisions', (req: Request, res: Response) => {
    try {
      const pr = req as PermRequest
      const { sourceId, entity, limit = '50' } = req.query as Record<string, string>
      let decisions = db.getTimeline(Number(limit) || 50)

      if (pr.allowedSourceIds !== null) {
        decisions = decisions.filter(d => pr.allowedSourceIds!.includes(d.sourceId))
      }
      if (sourceId) decisions = decisions.filter(d => d.sourceId === sourceId)
      if (entity) {
        const ent = entity.toLowerCase()
        decisions = decisions.filter(d =>
          d.relatedEntities.some(e => e.toLowerCase().includes(ent)) || d.title.toLowerCase().includes(ent)
        )
      }

      res.json({
        decisions: decisions.map(d => ({
          id: d.id, title: d.title, description: d.description, type: d.type,
          significance: d.significance, source: d.sourceName, sourceId: d.sourceId,
          relatedEntities: d.relatedEntities, timestamp: d.timestamp,
          date: new Date(d.timestamp).toISOString(),
        })),
        total: decisions.length,
      })
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  // ── POST /api/context/inject ────────────────────────────────────────────────
  apiRouter.post('/context/inject', (req: Request, res: Response) => {
    try {
      const pr = req as PermRequest
      const { scope = 'global', sourceId, maxTokens = 2000 } = req.body as {
        scope?: 'global' | 'project' | 'recent' | 'decisions'; sourceId?: string; maxTokens?: number
      }
      const charLimit = maxTokens * 4
      let contextBlock = ''
      let meta: Record<string, unknown> = {}

      if (scope === 'decisions') {
        let decisions = db.getTimeline(20)
        if (pr.allowedSourceIds !== null) decisions = decisions.filter(d => pr.allowedSourceIds!.includes(d.sourceId))
        contextBlock = `# Decision History\n` + decisions.map(d => `- **${d.title}** (${d.sourceName}): ${(d.description || '').substring(0, 150)}`).join('\n')
        meta = { scope, decisionCount: decisions.length }

      } else if (scope === 'project' && sourceId) {
        if (pr.allowedSourceIds !== null && !pr.allowedSourceIds.includes(sourceId)) {
          res.status(403).json({ error: 'Access to this source is not permitted' }); return
        }
        const source = db.getSource(sourceId)
        const nodes = db.getNodesBySource(sourceId).slice(0, 30)
        contextBlock = `# Project: ${source?.name || sourceId}\n\n` +
          nodes.map(n => `## ${n.title}\n${(n.summary || n.content).substring(0, 300)}`).join('\n\n')
        meta = { scope, sourceId, nodeCount: nodes.length }

      } else if (scope === 'recent') {
        let nodes = db.getNodes(20)
        if (pr.allowedSourceIds !== null) nodes = nodes.filter(n => pr.allowedSourceIds!.includes(n.sourceId))
        contextBlock = `# Recent Memory\n\n` + nodes.map(n =>
          `- **${n.title}** (${n.sourceName}): ${(n.summary || n.content.substring(0, 150)).replace(/\n/g, ' ')}`
        ).join('\n')
        meta = { scope, nodeCount: nodes.length }

      } else {
        let nodes = db.getNodes(30)
        if (pr.allowedSourceIds !== null) nodes = nodes.filter(n => pr.allowedSourceIds!.includes(n.sourceId))
        let decisions = db.getTimeline(5)
        if (pr.allowedSourceIds !== null) decisions = decisions.filter(d => pr.allowedSourceIds!.includes(d.sourceId))
        const entities = db.getEntities(20)
        contextBlock = `# ContextFabric Memory Snapshot\n\n## Key Technologies\n${entities.map(e => e.name).join(', ')}\n\n`
        contextBlock += `## Recent Decisions\n${decisions.map(d => `- ${d.title}`).join('\n') || 'None yet'}\n\n`
        contextBlock += `## Knowledge Base\n` + nodes.slice(0, 15).map(n =>
          `### ${n.title} (${n.sourceName})\n${(n.summary || n.content.substring(0, 200)).replace(/\n/g, ' ')}`
        ).join('\n\n')
        meta = { scope, nodeCount: nodes.length, decisionCount: decisions.length }
      }

      if (contextBlock.length > charLimit) contextBlock = contextBlock.substring(0, charLimit) + '\n\n[context truncated]'

      res.json({ scope, context: contextBlock, charCount: contextBlock.length, estimatedTokens: Math.round(contextBlock.length / 4), meta })
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  // ── POST /api/token ─────────────────────────────────────────────────────────
  apiRouter.post('/token', (req: Request, res: Response) => {
    try {
      const { query, ttlSeconds = 3600 } = req.body as { query?: string; ttlSeconds?: number }
      const nodes = query
        ? db.getNodes(500).filter(n => query.toLowerCase().split(/\s+/).some(w => `${n.title} ${n.content}`.toLowerCase().includes(w))).slice(0, 10)
        : db.getNodes(10)

      const decisions = db.getTimeline(5)
      const summary = nodes.map(n => `${n.title}: ${(n.summary || n.content).substring(0, 100)}`).join('\n')
      const context = [
        query ? `Query context for: "${query}"` : 'Global memory snapshot',
        `Sources: ${[...new Set(nodes.map(n => n.sourceName))].join(', ')}`,
        `\n${summary}`,
        decisions.length > 0 ? `\nKey decisions:\n${decisions.map(d => `- ${d.title}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')

      const token = randomBytes(24).toString('base64url')
      const expiresAt = Date.now() + ttlSeconds * 1000
      setToken(token, { context, summary: summary.substring(0, 200), expiresAt, createdAt: Date.now(), query })

      res.json({ token, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds, nodeCount: nodes.length, summary: summary.substring(0, 200), retrieveUrl: `http://localhost:${port}/api/token/${token}` })
    } catch (err) { res.status(500).json({ error: String(err) }) }
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
