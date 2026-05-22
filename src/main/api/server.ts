import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { app as electronApp } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DatabaseService } from '../services/database'
import type { OllamaService } from '../services/ollama'
import type { DataSource, MemoryNode } from '../../shared/types'
import { buildFallbackContextPayload } from '../../shared/contextAssembly'

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

function selectTokenNodes(nodes: MemoryNode[], query?: string, limit = 16): MemoryNode[] {
  // Context payloads must prefer durable memory over generated bundles or raw chunks.
  const terms = (query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.replace(/[^a-z0-9]/g, ''))
    .filter(term => term.length > 2)

  const scored = nodes
    .filter(node => !isGeneratedOrBundledNode(node))
    .map(node => ({ node, score: scoreTokenNode(node, terms, query || '') }))
    .filter(item => !query || item.score > 0)
    .sort((a, b) => b.score - a.score)

  const selected = scored.slice(0, limit).map(item => item.node)
  if (selected.length > 0) return selected

  return nodes
    .filter(node => !isGeneratedOrBundledNode(node))
    .sort((a, b) => tokenTypeWeight(b) - tokenTypeWeight(a) || b.timestamp - a.timestamp)
    .slice(0, limit)
}

function scoreTokenNode(node: MemoryNode, terms: string[], query: string): number {
  const title = node.title.toLowerCase()
  const content = node.content.toLowerCase()
  const summary = (node.summary || '').toLowerCase()
  const source = `${node.sourceName} ${node.sourceType}`.toLowerCase()
  const metadata = `${node.tags.join(' ')} ${node.entities.join(' ')}`.toLowerCase()
  const haystack = `${title} ${summary} ${content} ${source} ${metadata}`
  let score = tokenTypeWeight(node)

  if (isProjectContextQuery(query)) {
    if (['project', 'decision', 'style', 'preference', 'person'].includes(node.type)) score += 40
    if (/\b(readme|prompts|architecture|decision|adr|notes|writeup|docs?)\b/i.test(node.title)) score += 25
    if (/\b(contextfabric|gemma|local-first|memory|permission|extension|sqlite|ollama)\b/i.test(haystack)) score += 16
    if (node.type === 'code') score -= 18
  }

  for (const term of terms) {
    if (title.includes(term)) score += 8
    if (summary.includes(term)) score += 5
    if (metadata.includes(term)) score += 4
    if (content.includes(term)) score += 1
  }

  if (node.confidence >= 0.8) score += 8
  if (node.summary) score += 4
  return score
}

function tokenTypeWeight(node: MemoryNode): number {
  const weights: Record<string, number> = {
    project: 50,
    decision: 45,
    style: 40,
    preference: 40,
    person: 30,
    document: 20,
    note: 18,
    conversation: 12,
    code: 4,
    entity: 2,
  }
  return weights[node.type] || 0
}

function isProjectContextQuery(query: string): boolean {
  return /\b(project|working style|writing style|technical decisions|preferences|current context|context)\b/i.test(query)
}

function isGeneratedOrBundledNode(node: MemoryNode): boolean {
  const title = node.title.toLowerCase()
  const source = `${node.sourceName} ${node.sourceType}`.toLowerCase()
  const contentStart = node.content.slice(0, 1200)
  if (/\b(node_modules|\.vite|dist|out\/renderer|out\\renderer|build|coverage)\b/i.test(`${title} ${source}`)) return true
  if (/\b(index|chunk|vendor|bundle|assets?)[-.][a-z0-9_-]{6,}\.(js|css)\b/i.test(title)) return true
  if (/\.(min|bundle)\.(js|css)$/i.test(title)) return true
  if (node.type === 'code') {
    const longLines = contentStart.split(/\r?\n/).filter(line => line.length > 300).length
    const symbolRatio = contentStart.length
      ? (contentStart.match(/[{}();=><]/g)?.length || 0) / contentStart.length
      : 0
    if (longLines >= 2 || symbolRatio > 0.12) return true
  }
  return false
}

function getOrCreateHttpSource(db: DatabaseService): DataSource {
  // Manual API/UI additions share one stable source so users can audit them later.
  const id = 'local-http-api'
  const existing = db.getSource(id)
  if (existing) return existing
  const now = Date.now()
  const source: DataSource = {
    id,
    name: 'Local HTTP API',
    type: 'markdown',
    path: 'contextfabric-http://localhost:7749',
    status: 'ready',
    lastSynced: now,
    nodeCount: 0,
    color: '#22C55E',
    icon: 'terminal',
    enabled: true,
    metadata: { localHttpApi: true },
  }
  db.upsertSource(source)
  return source
}

async function saveNodeWithEmbedding(db: DatabaseService, ollama: OllamaService, node: MemoryNode): Promise<void> {
  db.upsertNode(node)
  const embeddingModel = db.getAllSettings().embeddingModel || 'nomic-embed-text'
  const embText = [node.title, node.summary || '', node.entities.join(', '), node.content.slice(0, 800)].join('\n')
  let embedding = ollama.fastEmbed(embText)
  try {
    const real = await ollama.embed(embText)
    if (real.length > 0) embedding = real
  } catch {
    // Deterministic local embedding is already available.
  }
  db.saveEmbedding(node.id, embedding, embeddingModel)
}

async function extractNodesFromText(
  db: DatabaseService,
  ollama: OllamaService,
  text: string,
  title = 'HTTP Extract',
  inputType = 'api',
  save = false
): Promise<{ source?: DataSource; rawNode?: MemoryNode; nodes: MemoryNode[]; savedCount: number }> {
  const now = Date.now()
  const source = getOrCreateHttpSource(db)
  const extraction = await ollama.extractContextNodes(text, inputType)
  const extracted = extraction.nodes.map((node, index): MemoryNode => ({
    id: uuidv4(),
    title: node.title,
    content: [
      node.summary,
      `Evidence: ${node.evidence}`,
      node.metadata.reasoning ? `Reasoning: ${node.metadata.reasoning}` : '',
    ].filter(Boolean).join('\n'),
    type: node.type,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    timestamp: now,
    confidence: node.confidence,
    tags: [...new Set(['http-extract', node.type, ...node.tags])],
    entities: node.entities,
    summary: node.summary,
    metadata: {
      ...node.metadata,
      confidence: node.confidence,
      evidence: node.evidence,
      extractionSchema: 'contextfabric.extraction.v1',
      extractor: 'gemma4',
      httpExtractIndex: index,
    },
  }))

  const nodes = extracted.length > 0 ? extracted : buildFallbackHttpNodes(text, title, source, now)
  if (!save) return { nodes, savedCount: 0 }

  const rawNode: MemoryNode = {
    id: uuidv4(),
    title,
    content: text,
    type: 'note',
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    timestamp: now,
    confidence: 1,
    tags: ['http-extract', 'raw'],
    entities: ollama.simpleEntityExtract(text).map(entity => entity.name),
    summary: text.slice(0, 220),
    metadata: { localHttpApi: true, raw: true },
  }
  await saveNodeWithEmbedding(db, ollama, rawNode)
  for (const node of nodes) {
    node.metadata = { ...node.metadata, extractedFromNodeId: rawNode.id }
    await saveNodeWithEmbedding(db, ollama, node)
  }
  db.updateSourceStatus(source.id, 'ready', db.getNodesBySource(source.id).length)
  return { source: db.getSource(source.id) || source, rawNode, nodes, savedCount: nodes.length + 1 }
}

function buildFallbackHttpNodes(text: string, title: string, source: DataSource, timestamp: number): MemoryNode[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  const type: MemoryNode['type'] = /\b(prefer|preference|like|want|style)\b/i.test(text)
    ? 'preference'
    : /\b(decided|chose|because|instead|tradeoff|decision)\b/i.test(text)
      ? 'decision'
      : /\b(project|building|app|tool|product)\b/i.test(text)
        ? 'project'
        : 'note'
  return [{
    id: uuidv4(),
    title: title || `HTTP ${type}`,
    content: clean,
    type,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    timestamp,
    confidence: 0.62,
    tags: ['http-extract', 'fallback', type],
    entities: [],
    summary: clean.slice(0, 220),
    metadata: { fallback: true, extractor: 'deterministic' },
  }]
}

// ── Permission middleware ─────────────────────────────────────────────────────

async function assembleTokenPayloadWithTimeout(
  ollama: OllamaService,
  input: { appId: string; query?: string; nodes: MemoryNode[]; maxWords?: number },
  timeoutMs = 15000
) {
  // Keep extension and judge-demo requests responsive even when local Gemma is busy.
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<ReturnType<typeof buildFallbackContextPayload>>(resolve => {
    timer = setTimeout(() => {
      resolve({
        ...buildFallbackContextPayload(input),
        warnings: ['Gemma assembly timed out, so ContextFabric used deterministic local assembly.'],
      })
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      ollama.assembleContextPayload(input),
      timeout,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function permissionMiddleware(db: DatabaseService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const pr = req as PermRequest

    const appId = ((req.headers['x-contextfabric-app'] as string) || 'external').toLowerCase()
    pr.appId = appId

    const settings = db.getAllSettings()
    const allowedApps = (settings.allowedApps as Record<string, boolean>) || {}
    const activeGrant = db.getActiveAppGrant(appId)
    const appAllowed = Boolean(activeGrant) || (allowedApps[appId] ?? false)

    if (!appAllowed) {
      res.status(403).json({ error: `App "${appId}" is not allowed. Request access and approve it in ContextFabric Permissions.` })
      return
    }

    const perms = (settings.contextPermissions || {}) as Record<string, {
      allowGlobal: boolean; allowVSCode: boolean; allowExternal: boolean
    }>

    if (Object.keys(perms).length === 0) {
      pr.allowedSourceIds = activeGrant?.sourceIds.length ? activeGrant.sourceIds : null
      next()
      return
    }

    const allowedBySourcePerms = Object.entries(perms)
      .filter(([, p]) => {
        if (appId === 'vscode') return p.allowVSCode
        if (appId === 'claude' || appId === 'global') return p.allowGlobal
        return p.allowExternal
      })
      .map(([id]) => id)

    pr.allowedSourceIds = activeGrant?.sourceIds.length
      ? filterByPermissions(activeGrant.sourceIds, allowedBySourcePerms)
      : allowedBySourcePerms

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
    const appId = ((req.headers['x-contextfabric-app'] as string) || 'external').toLowerCase()
    const entry = db.getContextToken(req.params.tokenId, appId)
    if (!entry) { res.status(404).json({ error: 'Token not found or expired' }); return }
    res.json({
      context: entry.context,
      summary: entry.summary,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      scope: entry.scope,
      sourceIds: entry.sourceIds,
    })
  })

  // Permission request flow - intentionally registered before permission middleware.
  apiRouter.post('/permission/request', (req: Request, res: Response) => {
    try {
      const appId = ((req.headers['x-contextfabric-app'] as string) || req.body?.appId || 'external').toLowerCase()
      const { scopes = ['context'], sourceIds = [], reason } = req.body as {
        scopes?: string[]
        sourceIds?: string[]
        reason?: string
      }
      const request = db.createPermissionRequest({
        appId,
        requestedScopes: Array.isArray(scopes) ? scopes : ['context'],
        requestedSourceIds: Array.isArray(sourceIds) ? sourceIds : [],
        reason,
      })
      res.status(202).json({
        requestId: request.id,
        status: request.status,
        appId: request.appId,
        message: 'Permission request sent to ContextFabric. Approve it in the Permissions screen.',
        pollUrl: `/api/permission/request/${request.id}`,
      })
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  apiRouter.get('/permission/request/:id', (req: Request, res: Response) => {
    const request = db.getPermissionRequest(req.params.id)
    if (!request) { res.status(404).json({ error: 'Permission request not found' }); return }
    res.json(request)
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

      db.logContextAccess({
        appId: pr.appId,
        action: 'context_query',
        sourceIds: [...new Set(scored.map(r => r.node.sourceId))],
        query,
        scope: 'context',
        success: true,
        details: `${scored.length} result(s) returned`,
      })

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

      db.logContextAccess({
        appId: pr.appId,
        action: 'memory_search',
        sourceIds: [...new Set(hits.map(r => r.node.sourceId))],
        query,
        scope: semantic ? 'semantic-search' : 'keyword-search',
        success: true,
        details: `${hits.length} result(s) returned`,
      })

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

      db.logContextAccess({
        appId: pr.appId,
        action: 'context_inject',
        sourceIds: sourceId ? [sourceId] : [],
        scope,
        success: true,
        details: `${contextBlock.length} character(s) returned`,
      })

      res.json({ scope, context: contextBlock, charCount: contextBlock.length, estimatedTokens: Math.round(contextBlock.length / 4), meta })
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  // ── POST /api/token ─────────────────────────────────────────────────────────
  apiRouter.post('/token', async (req: Request, res: Response) => {
    try {
      const pr = req as PermRequest
      const {
        query,
        ttlSeconds = 3600,
        targetApp,
        maxWords = 800,
      } = req.body as { query?: string; ttlSeconds?: number; targetApp?: string; maxWords?: number }
      const availableNodes = db.getNodes(800)
        .filter(n => pr.allowedSourceIds === null || pr.allowedSourceIds.includes(n.sourceId))
      const nodes = selectTokenNodes(availableNodes, query, 16)

      const assembly = await assembleTokenPayloadWithTimeout(ollama, {
        appId: targetApp || pr.appId,
        query,
        nodes,
        maxWords,
      })
      const summary = assembly.payload.substring(0, 220)
      const context = assembly.payload
      const sourceIds = [...new Set(nodes.map(n => n.sourceId))]

      db.logContextAssembly({
        appId: pr.appId,
        appFormat: assembly.appFormat,
        query,
        inputNodeIds: nodes.map(n => n.id),
        outputPayload: assembly.payload,
        wordCount: assembly.wordCount,
        warnings: assembly.warnings,
      })

      const created = db.createContextToken({
        context,
        summary: summary.substring(0, 200),
        query,
        appId: pr.appId,
        scope: query ? 'query-context' : 'global-context',
        sourceIds,
        ttlSeconds,
      })

      res.json({
        token: created.token,
        expiresAt: new Date(created.expiresAt).toISOString(),
        ttlSeconds,
        nodeCount: nodes.length,
        summary: created.summary,
        assembly: {
          appFormat: assembly.appFormat,
          wordCount: assembly.wordCount,
          usedNodeIds: assembly.usedNodeIds,
          warnings: assembly.warnings,
        },
        scope: created.scope,
        sourceIds: created.sourceIds,
        publicKey: db.getContextPublicKey(),
        retrieveUrl: `http://localhost:${port}/api/token/${created.token}`,
      })
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  apiRouter.get('/context/assembly-logs', (_req: Request, res: Response) => {
    try {
      res.json(db.getContextAssemblyLogs(100))
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

  startLocalChallengeApi(db, ollama, 7749)
}

function startLocalChallengeApi(db: DatabaseService, ollama: OllamaService, port: number): void {
  const compat = express()
  compat.use(express.json({ limit: '2mb' }))
  compat.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    res.on('finish', () => {
      writeLocalApiLog(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`)
    })
    next()
  })

  compat.get('/health', async (_req: Request, res: Response) => {
    const settings = db.getAllSettings()
    res.json({
      status: 'ok',
      api: 'contextfabric-local',
      host: '127.0.0.1',
      port,
      model: {
        available: await ollama.isConnected(),
        name: settings.ollamaModel,
        embeddingModel: settings.embeddingModel,
      },
      stats: db.getStats(),
    })
  })

  compat.post('/extract', async (req: Request, res: Response) => {
    try {
      const { text, title = 'HTTP Extract', inputType = 'api', save = false } = req.body as {
        text?: string
        title?: string
        inputType?: string
        save?: boolean
      }
      if (!text?.trim()) {
        res.status(400).json({ error: 'text is required' })
        return
      }
      const result = await extractNodesFromText(db, ollama, text, title, inputType, Boolean(save))
      res.json({
        ok: true,
        saved: Boolean(save),
        savedCount: result.savedCount,
        source: result.source ? { id: result.source.id, name: result.source.name } : undefined,
        rawNodeId: result.rawNode?.id,
        nodes: result.nodes.map(nodeToPublicJson),
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  compat.get('/context', async (req: Request, res: Response) => {
    try {
      const appId = String(req.query.app || req.query.appId || 'generic')
      const query = String(req.query.query || 'current project context, writing style, technical decisions, preferences')
      const maxWords = Number(req.query.maxWords || 800)
      const nodes = selectTokenNodes(db.getNodes(800), query, 16)
      const assembly = await assembleTokenPayloadWithTimeout(ollama, { appId, query, nodes, maxWords })
      db.logContextAssembly({
        appId: `local-http:${appId}`,
        appFormat: assembly.appFormat,
        query,
        inputNodeIds: nodes.map(node => node.id),
        outputPayload: assembly.payload,
        wordCount: assembly.wordCount,
        warnings: assembly.warnings,
      })
      res.json({
        ok: true,
        appFormat: assembly.appFormat,
        query,
        payload: assembly.payload,
        wordCount: assembly.wordCount,
        usedNodeIds: assembly.usedNodeIds,
        warnings: assembly.warnings,
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  compat.get('/nodes', (_req: Request, res: Response) => {
    try {
      const nodes = db.getNodes(1000)
      const grouped = nodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1
        return acc
      }, {})
      res.json({
        ok: true,
        total: nodes.length,
        grouped,
        nodes: nodes.map(nodeToPublicJson),
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  compat.post('/nodes', async (req: Request, res: Response) => {
    try {
      const source = getOrCreateHttpSource(db)
      const now = Date.now()
      const {
        title,
        content,
        type = 'note',
        confidence = 1,
        tags = [],
        entities = [],
        summary,
        metadata = {},
      } = req.body as Partial<MemoryNode>
      if (!title?.trim() || !content?.trim()) {
        res.status(400).json({ error: 'title and content are required' })
        return
      }
      const allowedTypes: MemoryNode['type'][] = ['conversation', 'document', 'code', 'note', 'decision', 'entity', 'project', 'style', 'preference', 'person']
      const nodeType = allowedTypes.includes(type as MemoryNode['type']) ? type as MemoryNode['type'] : 'note'
      const node: MemoryNode = {
        id: uuidv4(),
        title,
        content,
        type: nodeType,
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
        timestamp: now,
        confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
        tags: Array.isArray(tags) ? tags.map(String) : [],
        entities: Array.isArray(entities) ? entities.map(String) : [],
        summary: summary ? String(summary) : content.slice(0, 220),
        metadata: { ...(metadata as Record<string, unknown>), localHttpApi: true },
      }
      await saveNodeWithEmbedding(db, ollama, node)
      db.updateSourceStatus(source.id, 'ready', db.getNodesBySource(source.id).length)
      res.status(201).json({ ok: true, node: nodeToPublicJson(node) })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  compat.delete('/nodes/:id', (req: Request, res: Response) => {
    try {
      const deleted = db.deleteNode(req.params.id)
      if (!deleted) {
        res.status(404).json({ error: 'node not found' })
        return
      }
      res.json({ ok: true, deleted: true, id: req.params.id })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  compat.get('/ui', (_req: Request, res: Response) => {
    res.type('html').send(buildChallengeUiHtml())
  })

  const server = compat.listen(port, '127.0.0.1', () => {
    console.log(`[Local API] ContextFabric challenge API running on http://127.0.0.1:${port}`)
    writeLocalApiLog(`${new Date().toISOString()} START 127.0.0.1:${port}`)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Local API] Port ${port} already in use; challenge API not started.`)
      writeLocalApiLog(`${new Date().toISOString()} ERROR port ${port} already in use`)
    } else {
      console.warn('[Local API] Failed to start:', err.message)
      writeLocalApiLog(`${new Date().toISOString()} ERROR ${err.message}`)
    }
  })
}

function nodeToPublicJson(node: MemoryNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    summary: node.summary,
    content: node.content,
    confidence: node.confidence,
    source: node.sourceName,
    sourceId: node.sourceId,
    createdAt: new Date(node.timestamp).toISOString(),
    tags: node.tags,
    entities: node.entities,
    metadata: node.metadata,
  }
}

function writeLocalApiLog(line: string): void {
  try {
    const dir = join(electronApp.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'local-api-7749.log'), `${line}\n`, 'utf8')
  } catch {
    // Request logging must never break local API calls.
  }
}

function buildChallengeUiHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ContextFabric Local Memory</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080b14;
      --panel: #101624;
      --panel-2: #151c2c;
      --line: rgba(148, 163, 184, 0.16);
      --text: #f8fafc;
      --muted: #94a3b8;
      --soft: #cbd5e1;
      --accent: #7c3aed;
      --cyan: #22d3ee;
      --green: #34d399;
      --red: #fb7185;
    }
    * { box-sizing: border-box; letter-spacing: 0; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      border-bottom: 1px solid var(--line);
      background: rgba(8, 11, 20, 0.94);
      backdrop-filter: blur(16px);
    }
    .bar {
      max-width: 1240px;
      margin: 0 auto;
      padding: 18px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; }
    .subtitle { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
    .status {
      display: flex;
      gap: 10px;
      align-items: center;
      color: var(--soft);
      font-size: 13px;
      white-space: nowrap;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 18px var(--green); }
    main {
      max-width: 1240px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(340px, 0.75fr);
      gap: 18px;
    }
    section {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      overflow: hidden;
    }
    .section-head {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h2 { margin: 0; font-size: 15px; }
    .count { color: var(--muted); font-size: 12px; }
    .content { padding: 16px; }
    .grid { display: grid; gap: 12px; }
    .row { display: grid; grid-template-columns: 1fr 140px; gap: 10px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #0b1020;
      color: var(--text);
      padding: 10px 11px;
      font: inherit;
      font-size: 13px;
      outline: none;
    }
    textarea { min-height: 104px; resize: vertical; line-height: 1.5; }
    input:focus, textarea:focus, select:focus { border-color: rgba(34, 211, 238, 0.55); }
    button {
      border: 1px solid rgba(124, 58, 237, 0.5);
      border-radius: 7px;
      background: var(--accent);
      color: white;
      padding: 10px 12px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 650;
    }
    button.secondary { background: transparent; color: var(--soft); border-color: var(--line); }
    button.danger { background: transparent; border-color: rgba(251, 113, 133, 0.45); color: #fecdd3; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .message { color: var(--muted); font-size: 12px; min-height: 18px; }
    .types { display: flex; flex-wrap: wrap; gap: 8px; }
    .type-pill {
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--soft);
      border-radius: 7px;
      padding: 7px 9px;
      font-size: 12px;
    }
    .type-pill strong { color: var(--text); }
    .node-list { display: grid; gap: 12px; }
    .group { display: grid; gap: 8px; }
    .group-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--cyan);
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 750;
    }
    article.node {
      border: 1px solid var(--line);
      background: #0b1020;
      border-radius: 8px;
      padding: 12px;
      display: grid;
      gap: 8px;
    }
    .node-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .node h3 { margin: 0; font-size: 14px; line-height: 1.35; }
    .node p { margin: 0; color: var(--soft); font-size: 13px; line-height: 1.5; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 11px; }
    .score {
      min-width: 48px;
      text-align: center;
      border: 1px solid rgba(52, 211, 153, 0.28);
      color: #bbf7d0;
      background: rgba(52, 211, 153, 0.08);
      border-radius: 7px;
      padding: 5px 6px;
      font-size: 12px;
      font-weight: 700;
    }
    pre {
      margin: 0;
      min-height: 220px;
      max-height: 420px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #050816;
      color: #dbeafe;
      padding: 13px;
      white-space: pre-wrap;
      line-height: 1.55;
      font: 12px ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 960px) {
      main { grid-template-columns: 1fr; padding: 16px; }
      .bar { padding: 16px; align-items: flex-start; flex-direction: column; }
      .row, .split { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <div>
        <h1>ContextFabric Local Memory</h1>
        <p class="subtitle">Live daemon UI for nodes, Gemma extraction, and Claude context preview.</p>
      </div>
      <div class="status"><span class="dot"></span><span id="health">Checking local daemon...</span></div>
    </div>
  </header>
  <main>
    <div class="grid">
      <section>
        <div class="section-head">
          <h2>Memory Nodes</h2>
          <div class="actions">
            <span class="count" id="nodeCount">0 nodes</span>
            <button class="secondary" id="refreshNodes">Refresh</button>
          </div>
        </div>
        <div class="content grid">
          <div class="types" id="typeSummary"></div>
          <div class="node-list" id="nodeList"></div>
        </div>
      </section>
    </div>
    <aside class="grid">
      <section>
        <div class="section-head"><h2>Extract Context</h2><span class="count">Gemma 4</span></div>
        <div class="content grid">
          <label>Title <input id="extractTitle" value="Screenshot demo context"></label>
          <label>Paste text <textarea id="extractText">ContextFabric is a local-first AI memory layer. The user prefers simple testing steps, real working features, and no fake demos.</textarea></label>
          <div class="actions">
            <button id="extractBtn">Extract and save</button>
            <span class="message" id="extractMsg"></span>
          </div>
        </div>
      </section>
      <section>
        <div class="section-head"><h2>Add Manual Node</h2><span class="count">SQLite</span></div>
        <div class="content grid">
          <div class="row">
            <label>Title <input id="manualTitle" placeholder="Answer style"></label>
            <label>Type
              <select id="manualType">
                <option>preference</option><option>project</option><option>decision</option><option>style</option><option>person</option><option>note</option><option>document</option><option>code</option>
              </select>
            </label>
          </div>
          <label>Content <textarea id="manualContent" placeholder="The user prefers concise answers with exact test commands."></textarea></label>
          <div class="actions">
            <button id="addNodeBtn">Add node</button>
            <span class="message" id="manualMsg"></span>
          </div>
        </div>
      </section>
      <section>
        <div class="section-head"><h2>Claude Context Preview</h2><span class="count" id="previewWords">0 words</span></div>
        <div class="content grid">
          <label>Query <input id="previewQuery" value="current project context, writing style, technical decisions, preferences"></label>
          <div class="actions">
            <button id="previewBtn">Preview Claude payload</button>
            <button class="secondary" id="copyPreview">Copy</button>
          </div>
          <pre id="preview">Click preview to see what ContextFabric would inject into Claude right now.</pre>
        </div>
      </section>
    </aside>
  </main>
  <script>
    const state = { nodes: [] };
    const api = async (url, options) => {
      const res = await fetch(url, options);
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(body.error || res.statusText);
      return body;
    };
    const byId = id => document.getElementById(id);
    const escapeHtml = value => String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
    const pct = value => Math.round(Number(value || 0) * 100);

    async function loadHealth() {
      try {
        const health = await api('/health');
        byId('health').textContent = 'Local daemon online - ' + health.model.name + (health.model.available ? ' connected' : ' offline');
      } catch (error) {
        byId('health').textContent = 'Daemon unavailable: ' + error.message;
      }
    }

    async function loadNodes() {
      const data = await api('/nodes');
      state.nodes = data.nodes || [];
      byId('nodeCount').textContent = data.total + ' nodes';
      renderTypeSummary(data.grouped || {});
      renderNodes(state.nodes);
    }

    function renderTypeSummary(grouped) {
      const keys = Object.keys(grouped).sort();
      byId('typeSummary').innerHTML = keys.length
        ? keys.map(type => '<span class="type-pill"><strong>' + escapeHtml(type) + '</strong> ' + grouped[type] + '</span>').join('')
        : '<span class="type-pill">No nodes yet</span>';
    }

    function renderNodes(nodes) {
      const grouped = nodes.reduce((acc, node) => {
        (acc[node.type] ||= []).push(node);
        return acc;
      }, {});
      const html = Object.keys(grouped).sort().map(type => {
        const items = grouped[type].map(node => (
          '<article class="node">' +
            '<div class="node-top"><h3>' + escapeHtml(node.title) + '</h3><span class="score">' + pct(node.confidence) + '%</span></div>' +
            '<p>' + escapeHtml(node.summary || node.content || '') + '</p>' +
            '<div class="meta"><span>' + escapeHtml(node.source) + '</span><span>' + escapeHtml(node.createdAt) + '</span><span>' + escapeHtml(node.id.slice(0, 8)) + '</span></div>' +
            '<div class="actions"><button class="danger" data-delete="' + escapeHtml(node.id) + '">Delete</button></div>' +
          '</article>'
        )).join('');
        return '<div class="group"><div class="group-title"><span>' + escapeHtml(type) + '</span><span>' + grouped[type].length + '</span></div>' + items + '</div>';
      }).join('');
      byId('nodeList').innerHTML = html || '<article class="node"><p>No nodes yet. Extract or add one to begin.</p></article>';
    }

    async function extractAndSave() {
      byId('extractMsg').textContent = 'Extracting...';
      const data = await api('/extract', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ title: byId('extractTitle').value, text: byId('extractText').value, save: true })
      });
      byId('extractMsg').textContent = 'Saved ' + data.savedCount + ' node(s).';
      await loadNodes();
      await previewContext();
    }

    async function addManualNode() {
      byId('manualMsg').textContent = 'Saving...';
      await api('/nodes', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          title: byId('manualTitle').value,
          type: byId('manualType').value,
          content: byId('manualContent').value,
          confidence: 0.95
        })
      });
      byId('manualMsg').textContent = 'Node saved.';
      byId('manualTitle').value = '';
      byId('manualContent').value = '';
      await loadNodes();
      await previewContext();
    }

    async function deleteNode(id) {
      await api('/nodes/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadNodes();
      await previewContext();
    }

    async function previewContext() {
      byId('preview').textContent = 'Assembling Claude preview...';
      const params = new URLSearchParams({ app: 'claude', query: byId('previewQuery').value, maxWords: '800' });
      const data = await api('/context?' + params.toString());
      byId('preview').textContent = data.payload || '';
      byId('previewWords').textContent = (data.wordCount || 0) + ' words';
    }

    byId('refreshNodes').addEventListener('click', loadNodes);
    byId('extractBtn').addEventListener('click', () => extractAndSave().catch(error => byId('extractMsg').textContent = error.message));
    byId('addNodeBtn').addEventListener('click', () => addManualNode().catch(error => byId('manualMsg').textContent = error.message));
    byId('previewBtn').addEventListener('click', () => previewContext().catch(error => byId('preview').textContent = error.message));
    byId('copyPreview').addEventListener('click', async () => navigator.clipboard.writeText(byId('preview').textContent || ''));
    byId('nodeList').addEventListener('click', event => {
      const id = event.target && event.target.getAttribute && event.target.getAttribute('data-delete');
      if (id) deleteNode(id).catch(error => alert(error.message));
    });

    loadHealth();
    loadNodes().then(previewContext).catch(error => {
      byId('nodeList').innerHTML = '<article class="node"><p>' + escapeHtml(error.message) + '</p></article>';
    });
  </script>
</body>
</html>`;
}
