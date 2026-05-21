import { ipcMain, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DatabaseService } from '../services/database'
import type { OllamaService } from '../services/ollama'
import { SearchService } from '../services/search'
import { IngestionService } from '../services/ingestion'
import type { SyncService } from '../services/sync'
import type { DataSource, AIQueryResult, AppSettings } from '../../shared/types'

export function registerIpcHandlers(
  db: DatabaseService,
  ollama: OllamaService,
  getWindow: () => BrowserWindow | null,
  sync?: SyncService
): IngestionService {
  const search = new SearchService(db, ollama)
  const ingestion = new IngestionService(db, ollama)

  // === MEMORY ===

  ipcMain.handle('memory:search', async (_, query: string, limit = 20) => {
    // Empty query = fetch most recent nodes by timestamp directly
    if (!query || !query.trim()) {
      const nodes = db.getNodes(limit)
      return nodes.map(n => ({
        node: n,
        score: 1,
        highlights: [n.summary || n.content.substring(0, 120)],
        sourceContext: `${n.sourceName} Â· ${new Date(n.timestamp).toLocaleDateString()}`,
      }))
    }
    return await search.hybridSearch(query, limit)
  })

  ipcMain.handle('memory:query', async (_, query: string) => {
    const start = Date.now()
    ingestion.setQueryActive(true)

    try {
    // Build source metadata context â€” always included so Gemma knows what exists
    const allSources = db.getSources()
    const sourceMeta = allSources
      .filter(s => s.status === 'ready')
      .map(s => {
        const pathParts = s.path.replace(/\\/g, '/').split('/')
        const folderName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || s.name
        return `- "${s.name}" (${s.type}): path="${s.path}", folder="${folderName}", ${s.nodeCount} files indexed`
      })
      .join('\n')

    // Expand query into multiple search terms
    const expansionTerms = expandQuery(query)
    const allResults = await Promise.all(
      expansionTerms.map(q => search.hybridSearch(q, 5))
    )

    // For "what should another AI assistant know" style questions, prefer the
    // structured nodes Gemma extracted over raw chat/code chunks.
    const profileMode = isContextProfileQuery(query)
    const profileResults = profileMode
      ? db.getNodes(1000)
          .filter(node => ['project', 'style', 'decision', 'preference', 'person'].includes(node.type))
          .map(node => ({
            node,
            score: contextProfileScore(node, query),
            highlights: [node.summary || node.content.substring(0, 180)],
            sourceContext: `${node.sourceName} · Gemma extracted ${node.type}`,
          }))
          .filter(result => result.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
      : []

    // Deduplicate, boost identity/doc matches, and demote layout-only code chunks.
    const seen = new Set<string>()
    const queryIdentity = query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !['could', 'tell', 'know', 'about', 'what', 'please', 'you', 'the', 'can'].includes(w))
    const compactIdentity = queryIdentity.join('')
    const candidates = [...profileResults, ...allResults.flat()]
      .filter(r => { if (seen.has(r.node.id)) return false; seen.add(r.node.id); return true })
      .map(r => {
        const chunkIndex = (r.node.metadata as Record<string, unknown>)?.chunkIndex as number ?? 99
        const earlyBoost = r.node.type === 'code' ? 0 : chunkIndex <= 2 ? 0.15 : chunkIndex <= 5 ? 0.07 : 0
        const title = r.node.title.toLowerCase()
        const compactText = `${r.node.title} ${r.node.content.slice(0, 1500)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
        const nameBoost = (
          title.includes('readme') || title.includes('requirements') ||
          title.includes('package.json') || title.includes('pyproject') ||
          title.includes('cargo.toml') || title.includes('go.mod') ||
          title.includes('setup.py') || title.includes('setup.cfg')
        ) ? 0.25 : 0
        const identityBoost = compactIdentity && compactText.includes(compactIdentity) ? 0.55 : 0
        const profileBoost = profileMode && ['project', 'style', 'decision', 'preference', 'person'].includes(r.node.type)
          ? 0.8
          : 0
        const layoutPenalty = r.node.type === 'code' && looksLikeLayoutOrStyles(r.node.content) ? 0.45 : 1
        return { ...r, score: (r.score + earlyBoost + nameBoost + identityBoost + profileBoost) * layoutPenalty }
      })
      .sort((a, b) => b.score - a.score)

    const literalMatches = candidates.filter(r => hasLiteralIdentityMatch(r.node.title, r.node.content, queryIdentity, compactIdentity))
    const nonLayoutMatches = literalMatches.filter(r => !looksLikeLayoutOrStyles(r.node.content))
    const profilePool = profileMode ? candidates.filter(r => isProfileSafeNode(r.node)) : []
    const pool = profileMode
      ? profilePool
      : nonLayoutMatches.length > 0 ? nonLayoutMatches : literalMatches.length > 0 ? literalMatches : candidates
    const merged = pool.slice(0, 6)

    const importLines = extractImportLines(merged.map(r => r.node.content))

    // â”€â”€ Decision chain: fetch timeline events relevant to the query â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const allTimeline = db.getTimeline(50)
    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    const decisionChain = allTimeline
      .filter(e => {
        const text = `${e.title} ${e.description} ${e.relatedEntities.join(' ')}`.toLowerCase()
        return [...queryWords].some(w => text.includes(w))
      })
      .slice(0, 5)
      .map(e => `${e.title}${e.description ? ` â€” ${e.description.substring(0, 80)}` : ''}`)

    // â”€â”€ Conflict detection: same entity, opposing sentiment across chunks â”€â”€â”€â”€â”€â”€
    const conflicts = detectConflicts(merged.map(r => r.node))

    const contextChunks = merged.map(r => ({
      content: r.node.content,
      source: `${r.node.sourceName} â€” ${r.node.title}`,
      timestamp: r.node.timestamp,
      sourceType: r.node.type,
    }))

    const results = merged

    let answer: string
    let reasoning: string
    let citations: AIQueryResult['citations'] = []
    let detectedConflicts: string[] = []
    try {
      if (profileMode && contextChunks.length === 0) {
        answer = buildProfileNotReadyAnswer(allSources)
        reasoning = 'Profile-style query skipped noisy raw conversation fallback because no structured profile nodes or high-signal project docs were available.'
      } else if (profileMode) {
        const profile = buildLocalProfileAnswer(merged.map(r => r.node), allSources)
        answer = profile.answer
        reasoning = profile.reasoning
        citations = profile.citations
      } else {
        const r = await ollama.queryWithContext(
          query, contextChunks, importLines, sourceMeta, decisionChain, conflicts,
          (chunk) => { getWindow()?.webContents.send('query:chunk', chunk) }
        )
        answer = r.answer
        reasoning = r.reasoning
        citations = r.citations
        detectedConflicts = r.detectedConflicts
      }
    } catch (aiErr) {
      console.error('[Query] Ollama error:', aiErr instanceof Error ? aiErr.message : aiErr)
      if (merged.length > 0) {
        answer = ollama.buildExtractiveAnswer(query, contextChunks)
        reasoning = `Generated a local extractive answer from ${Math.min(merged.length, 4)} retrieved source chunk(s) because the model call failed.`
      } else {
        answer = `Nothing found in your indexed sources matching "${query}".`
        reasoning = 'No matching sources found.'
      }
    }

    const entities = new Set<string>()
    for (const r of results) r.node.entities.forEach(e => entities.add(e))

    const result: AIQueryResult = {
      query,
      answer,
      reasoning,
      sources: results,
      entities: Array.from(entities).slice(0, 10),
      confidence: results.length > 0 ? Math.min(results[0].score * 100, 95) : 20,
      processingTime: Date.now() - start,
      citations,
      conflicts: [...conflicts, ...detectedConflicts].slice(0, 3),
      decisionChain: decisionChain.length > 0 ? decisionChain : undefined,
    }

    // Persist to DB so history survives app restarts
    db.saveQueryHistory(result)

    return result
    } finally {
      ingestion.setQueryActive(false)
    }
  })

  ipcMain.handle('memory:get-history', async (_, limit = 30) => {
    return db.getQueryHistory(limit)
  })

  ipcMain.handle('memory:get-node', async (_, id: string) => {
    return db.getNode(id)
  })

  ipcMain.handle('memory:get-graph', async () => {
    const nodes = db.getNodes(500)
    const edges = db.getAllEdges()

    const sourceColors: Record<string, string> = {}
    const sources = db.getSources()
    for (const s of sources) sourceColors[s.id] = s.color

    const typeColors: Record<string, string> = {
      conversation: '#6366F1',
      document: '#8B5CF6',
      code: '#06B6D4',
      note: '#10B981',
      decision: '#F59E0B',
      entity: '#EF4444',
      project: '#EC4899',
    }

    return {
      nodes: nodes.map(n => ({
        id: n.id,
        label: n.title.substring(0, 40),
        type: n.type,
        size: Math.min(20 + n.content.length / 200, 50),
        color: sourceColors[n.sourceId] || typeColors[n.type] || '#6366F1',
        data: n,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight,
        label: e.label,
      })),
      clusters: [],
    }
  })

  ipcMain.handle('memory:get-timeline', async (_, limit = 100) => {
    return db.getTimeline(limit)
  })

  ipcMain.handle('memory:get-stats', async () => {
    const stats = db.getStats()
    stats.ollamaConnected = await ollama.isConnected()
    return stats
  })

  // === SOURCES ===

  ipcMain.handle('sources:list', async () => {
    return db.getSources()
  })

  ipcMain.handle('sources:add', async (_, sourceData: Omit<DataSource, 'id' | 'status' | 'nodeCount'>) => {
    const source: DataSource = {
      ...sourceData,
      id: uuidv4(),
      status: 'idle',
      nodeCount: 0,
    }
    db.upsertSource(source)
    return source
  })

  ipcMain.handle('sources:remove', async (_, id: string) => {
    ingestion.stopWatcher(id)
    db.deleteSource(id)
    return true
  })

  ipcMain.handle('sources:sync', async (_, id: string) => {
    const source = db.getSource(id)
    if (!source) throw new Error('Source not found')

    const onStatus = (status: unknown) => {
      getWindow()?.webContents.send('processing:status', status)
    }

    ingestion.ingestSource(source, onStatus).then(count => {
      getWindow()?.webContents.send('source:synced', { id, count })
    }).catch(err => {
      getWindow()?.webContents.send('source:error', { id, error: err.message })
    })

    return { started: true }
  })

  ipcMain.handle('sources:toggle', async (_, id: string, enabled: boolean) => {
    const source = db.getSource(id)
    if (!source) throw new Error('Source not found')
    source.enabled = enabled
    db.upsertSource(source)
    return source
  })

  // === ENTITIES ===

  ipcMain.handle('entities:list', async (_, limit = 100) => {
    return db.getEntities(limit)
  })

  // === SETTINGS ===

  ipcMain.handle('settings:get', async () => {
    return db.getAllSettings()
  })

  ipcMain.handle('settings:set', async (_, key: keyof AppSettings, value: unknown) => {
    db.setSetting(key as string, value)

    // Update ollama config if relevant
    if (['ollamaUrl', 'ollamaModel', 'embeddingModel'].includes(key as string)) {
      const settings = db.getAllSettings()
      ollama.updateConfig(settings.ollamaUrl, settings.ollamaModel, settings.embeddingModel)
    }
    if (['geminiApiKey', 'geminiModel'].includes(key as string)) {
      const settings = db.getAllSettings()
      ollama.setGeminiKey(settings.geminiApiKey || '', settings.geminiModel)
    }

    return true
  })

  // === MULTI-DEVICE SYNC ===

  ipcMain.handle('sync:status', async () => {
    return sync?.status() ?? db.getCRSQLiteStatus()
  })

  ipcMain.handle('sync:run', async (_, peerUrl?: string, peerKey?: string) => {
    const settings = db.getAllSettings()
    const url = peerUrl || settings.syncPeerUrl
    const key = peerKey || settings.syncPeerKey
    if (!sync) throw new Error('Sync service is not running')
    if (!url || !key) throw new Error('Peer URL and sync key are required')
    const result = await sync.run(String(url), String(key))
    if (peerUrl) db.setSetting('syncPeerUrl', peerUrl)
    if (peerKey) db.setSetting('syncPeerKey', peerKey)
    return result
  })

  // === OLLAMA ===

  ipcMain.handle('ollama:status', async () => {
    return {
      connected: await ollama.isConnected(),
      models: await ollama.listModels(),
    }
  })

  ipcMain.handle('ollama:models', async () => {
    return ollama.listModels()
  })

  // === CONTEXT EXPORT ===

  ipcMain.handle('context:export', async (_, query: string, maxChunks = 8) => {
    const results = await search.hybridSearch(query, maxChunks)
    return results.map(r => ({
      content: r.node.content,
      source: r.node.sourceName,
      title: r.node.title,
      timestamp: r.node.timestamp,
      score: r.score,
    }))
  })

  // === SOURCE SUMMARY ===

  ipcMain.handle('sources:summary', async (_, sourceId: string) => {
    const source = db.getSource(sourceId)
    if (!source) return null
    const nodes = db.getNodesBySource(sourceId)
    const decisions = db.getTimeline(100).filter(e => e.sourceId === sourceId).slice(0, 5)
    const entityCounts = new Map<string, number>()
    for (const node of nodes) {
      for (const e of node.entities) {
        entityCounts.set(e, (entityCounts.get(e) || 0) + 1)
      }
    }
    const topEntities = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }))

    return {
      source,
      topEntities,
      decisions,
      nodeTypes: nodes.reduce((acc, n) => {
        acc[n.type] = (acc[n.type] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    }
  })

  // === PERMISSIONS / TOKENS ===

  ipcMain.handle('tokens:list', () => db.listContextTokens())
  ipcMain.handle('tokens:revoke', (_, token: string) => db.revokeContextToken(token))
  ipcMain.handle('tokens:revoke-all', () => { db.revokeAllContextTokens(); return true })
  ipcMain.handle('tokens:audit-log', (_, limit = 100) => db.getContextAccessLogs(limit))
  ipcMain.handle('permissions:requests', (_, limit = 20) => db.getPendingPermissionRequests(limit))
  ipcMain.handle('permissions:resolve', (_, id: string, decision: 'one_hour' | 'session' | 'always' | 'deny') =>
    db.resolvePermissionRequest(id, decision)
  )

  ipcMain.handle('conflicts:list', (_, status: 'open' | 'all' = 'open', limit = 100) =>
    db.getConflicts(status, limit)
  )
  ipcMain.handle('conflicts:resolve', (_, id: string, status: 'accepted_new' | 'kept_existing' | 'kept_both' | 'dismissed') =>
    db.resolveConflict(id, status)
  )

  // Restore file watchers for all ready sources (after app restart)
  ingestion.watchAllSources()

  return ingestion
}

function expandQuery(query: string): string[] {
  const q = query.toLowerCase()
  const terms: string[] = [query]

  if (q.match(/stack|technolog|framework|language|library|tool|built with|using/)) {
    terms.push('import require from dependencies')
    terms.push('requirements.txt package.json pyproject.toml go.mod Cargo.toml')
    terms.push('README')
  }
  if (q.match(/recent|latest|last|current|project/)) {
    terms.push('README main app index')
    terms.push('import')
  }
  if (isContextProfileQuery(query)) {
    terms.push('project style decision preference person working style context')
    terms.push('what another assistant should know project preferences decisions')
  }
  if (q.match(/why|decision|chose|pick|reject|switch/)) {
    terms.push('decision architecture reason')
  }
  if (q.match(/auth|login|user|session|token/)) {
    terms.push('authentication JWT session token login')
  }
  if (q.match(/database|db|storage|persist/)) {
    terms.push('database SQL postgres sqlite mongo redis')
  }

  return [...new Set(terms)]
}

function isContextProfileQuery(query: string): boolean {
  return /\b(assistant|context|working style|work style|style|preference|preferences|project context|should know|know about me|background)\b/i.test(query)
}

function contextProfileScore(node: import('../../shared/types').MemoryNode, query: string): number {
  const typeWeight: Record<string, number> = {
    project: 1.0,
    decision: 0.95,
    preference: 0.9,
    style: 0.88,
    person: 0.72,
  }
  const q = query.toLowerCase()
  let score = typeWeight[node.type] || 0
  if (q.includes(node.type)) score += 0.35
  const confidence = Number((node.metadata as Record<string, unknown>).confidence || 0)
  score += Math.max(0, Math.min(1, confidence)) * 0.35
  const text = `${node.title} ${node.summary || ''} ${node.content} ${node.tags.join(' ')}`.toLowerCase()
  for (const word of ['project', 'style', 'preference', 'decision', 'assistant', 'context']) {
    if (q.includes(word) && text.includes(word)) score += 0.12
  }
  return score
}

function isProfileSafeNode(node: import('../../shared/types').MemoryNode): boolean {
  if (['project', 'style', 'decision', 'preference', 'person'].includes(node.type)) {
    return isUsefulProfileAnswerText(node.summary || node.content)
  }
  if (node.type === 'conversation') return false
  const path = String((node.metadata as Record<string, unknown>).path || '').toLowerCase().replace(/\\/g, '/')
  if (/\bmanifest\.json$/.test(path) || /browser-extension\/.*\.(js|json)$/.test(path)) return false
  const title = node.title.toLowerCase()
  const text = `${node.title} ${node.content.slice(0, 1200)} ${node.tags.join(' ')}`.toLowerCase()
  const highSignalTitle = /\b(readme|prompts|architecture|decision|adr|notes|writeup|package\.json|env\.example)\b/i.test(title)
  const highSignalContent = /\b(contextfabric|gemma|local-first|privacy|memory graph|permission|project|preference|decision|style)\b/i.test(text)
  return highSignalTitle && highSignalContent && !looksLikeLayoutOrStyles(node.content)
}

function buildProfileNotReadyAnswer(sources: import('../../shared/types').DataSource[]): string {
  const ready = sources.filter(source => source.status === 'ready')
  if (ready.length === 0) {
    return 'I do not have enough indexed memory to describe your project or working style yet. Add a real project folder, notes, or export in Sources, then sync it.'
  }
  const sourceNames = ready.slice(0, 4).map(source => source.name).join(', ')
  return `I found indexed sources (${sourceNames}), but no reliable structured project/style/preference/decision/person profile nodes yet. Let background extraction finish, or sync a project README/notes folder so I can answer this without guessing from unrelated chat snippets.`
}

function buildLocalProfileAnswer(
  nodes: import('../../shared/types').MemoryNode[],
  sources: import('../../shared/types').DataSource[]
): { answer: string; reasoning: string; citations: AIQueryResult['citations'] } {
  const typed = nodes.filter(node => ['project', 'style', 'decision', 'preference', 'person'].includes(node.type))
    .filter(node => isUsefulProfileAnswerText(node.summary || node.content))
  const byType = (type: string) => typed.filter(node => node.type === type)
  const parts: string[] = []

  const project = bestProjectNode(byType('project'), nodes)
  if (project) parts.push(`Project: ${cleanProfileSentence(project.summary || project.content)}`)

  const decisions = byType('decision').slice(0, 2)
  if (decisions.length > 0) parts.push(`Decisions: ${decisions.map(node => cleanProfileSentence(node.summary || node.content)).join(' ')}`)

  const preferences = [...byType('preference'), ...byType('style')].slice(0, 3)
  if (preferences.length > 0) parts.push(`Working style/preferences: ${preferences.map(node => cleanProfileSentence(node.summary || node.content)).join(' ')}`)

  const people = byType('person').slice(0, 2)
  if (people.length > 0) parts.push(`People: ${people.map(node => cleanProfileSentence(node.summary || node.content)).join(' ')}`)

  if (parts.length === 0) {
    return {
      answer: buildProfileNotReadyAnswer(sources),
      reasoning: 'No safe profile nodes were available.',
      citations: [],
    }
  }

  parts.push('Use those facts as background context, and cite the source memory when making project-specific claims.')

  const citations = nodes.slice(0, 6).map((node, index) => ({
    index: index + 1,
    title: node.title,
    sourceName: node.sourceName,
  }))

  return {
    answer: parts.join('\n\n'),
    reasoning: `Built a local profile answer from ${nodes.length} safe project/profile node(s), preferring Gemma-extracted typed context over raw chat snippets.`,
    citations,
  }
}

function cleanProfileSentence(text: string): string {
  return text
    .replace(/\b(defaultQuery|DEFAULT_QUERY|query)\s*:\s*['"][^'"]+['"],?/gi, '')
    .replace(/^["']?(description|name|version|default_title|title)["']?\s*:\s*["']?/i, '')
    .replace(/["'],?\s*$/g, '')
    .replace(/\b(current project context, writing style, technical decisions, preferences)\b/gi, '')
    .replace(/^Evidence:\s*/gim, '')
    .replace(/^Reasoning:\s*/gim, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)[0]
    .slice(0, 220)
}

function isUsefulProfileAnswerText(text: string): boolean {
  const cleaned = cleanProfileSentence(text)
  if (cleaned.length < 45) return false
  if (/\b(defaultQuery|DEFAULT_QUERY|placeholder|data-default-query|document\.querySelector|settings\.defaultQuery)\b/i.test(text)) return false
  if (/^["']?[a-zA-Z0-9_$-]+["']?\s*:\s*["']/.test(text.trim())) return false
  return /\b(ContextFabric|Gemma|local-first|privacy|memory|graph|permission|extension|Ollama|sync|source|assistant|project|decision|preference|style)\b/i.test(cleaned)
}

function bestProjectNode(
  projectNodes: import('../../shared/types').MemoryNode[],
  allNodes: import('../../shared/types').MemoryNode[]
): import('../../shared/types').MemoryNode | undefined {
  const candidates = [...projectNodes, ...allNodes.filter(node => /\b(readme|writeup|prompts|architecture|overview)\b/i.test(node.title))]
    .filter(node => isUsefulProfileAnswerText(node.summary || node.content))
    .filter(node => {
      const path = String((node.metadata as Record<string, unknown>).path || '').toLowerCase().replace(/\\/g, '/')
      return !/\bmanifest\.json$/.test(path) && !/browser-extension\/.*\.(js|json)$/.test(path)
    })

  return candidates.sort((a, b) => projectDocScore(b) - projectDocScore(a))[0]
}

function projectDocScore(node: import('../../shared/types').MemoryNode): number {
  const title = node.title.toLowerCase()
  const path = String((node.metadata as Record<string, unknown>).path || '').toLowerCase().replace(/\\/g, '/')
  let score = 0
  if (/\breadme\.md\b/.test(title) || /\/readme\.md$/.test(path)) score += 10
  if (/\bwriteup\.md\b/.test(title) || /\/writeup\.md$/.test(path)) score += 8
  if (/\bprompts\.md\b/.test(title) || /\/prompts\.md$/.test(path)) score += 5
  if (/\barchitecture|overview|adr|decision\b/.test(title)) score += 4
  score += Number((node.metadata as Record<string, unknown>).confidence || 0)
  return score
}

function looksLikeLayoutOrStyles(content: string): boolean {
  const text = content.slice(0, 1600).toLowerCase()
  const markers = ['display:', 'position:', 'padding:', 'margin:', 'background:', 'border:', 'animation:', 'z-index:', '/*', '</div>']
  return markers.filter(marker => text.includes(marker)).length >= 4
}

function hasLiteralIdentityMatch(title: string, content: string, terms: string[], compactTerms: string): boolean {
  if (terms.length === 0) return true
  const text = `${title} ${content.slice(0, 5000)}`.toLowerCase()
  const compactText = text.replace(/[^a-z0-9]/g, '')
  return terms.some(term => text.includes(term)) || Boolean(compactTerms && compactText.includes(compactTerms))
}

// Pull every import/require/use line from code chunks so Gemma
// gets explicit library names even if the relevant chunk wasn't top-ranked.
function extractImportLines(contents: string[]): string[] {
  const seen = new Set<string>()
  const lines: string[] = []

  const importRe = /^(import |from |require\(|use |#include |using )/

  for (const content of contents) {
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length > 3 && trimmed.length < 120 && importRe.test(trimmed)) {
        if (!seen.has(trimmed)) {
          seen.add(trimmed)
          lines.push(trimmed)
        }
      }
    }
  }

  return lines.slice(0, 40) // cap at 40 lines to keep prompt tight
}

// Detect conflicting claims: same entity, opposing sentiment across different nodes
function detectConflicts(nodes: import('../../shared/types').MemoryNode[]): string[] {
  const positiveRe = /\b(use|using|chose|chosen|adopted|went with|decided on|picked)\s+(\w+)/gi
  const negativeRe = /\b(rejected|replaced|dropped|abandoned|switched from|moved away from|stopped using)\s+(\w+)/gi

  const positive = new Map<string, string>() // entity â†’ source title
  const negative = new Map<string, string>()
  const conflicts: string[] = []

  for (const node of nodes) {
    const src = node.title
    let m: RegExpExecArray | null
    const pos = new RegExp(positiveRe.source, 'gi')
    while ((m = pos.exec(node.content)) !== null) {
      positive.set(m[2].toLowerCase(), src)
    }
    const neg = new RegExp(negativeRe.source, 'gi')
    while ((m = neg.exec(node.content)) !== null) {
      negative.set(m[2].toLowerCase(), src)
    }
  }

  for (const [entity, posSrc] of positive) {
    const negSrc = negative.get(entity)
    if (negSrc && negSrc !== posSrc) {
      conflicts.push(`"${entity}" â€” ${posSrc} says it's in use, ${negSrc} says it was replaced`)
    }
  }

  return conflicts.slice(0, 3)
}
