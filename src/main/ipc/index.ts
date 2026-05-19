import { ipcMain, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DatabaseService } from '../services/database'
import type { OllamaService } from '../services/ollama'
import { SearchService } from '../services/search'
import { IngestionService } from '../services/ingestion'
import type { DataSource, AIQueryResult, AppSettings } from '../../shared/types'

export function registerIpcHandlers(
  db: DatabaseService,
  ollama: OllamaService,
  mainWindow: BrowserWindow | null
): void {
  const search = new SearchService(db, ollama)
  const ingestion = new IngestionService(db, ollama)

  // === MEMORY ===

  ipcMain.handle('memory:search', async (_, query: string, limit = 20) => {
    return await search.hybridSearch(query, limit)
  })

  ipcMain.handle('memory:query', async (_, query: string) => {
    const start = Date.now()
    const results = await search.hybridSearch(query, 6)

    const contextChunks = results.map(r => ({
      content: r.node.content,
      source: `${r.node.sourceName} — ${r.node.title}`,
      timestamp: r.node.timestamp,
    }))

    const { answer, reasoning } = await ollama.queryWithContext(query, contextChunks)

    const entities = new Set<string>()
    for (const r of results) {
      r.node.entities.forEach(e => entities.add(e))
    }

    const result: AIQueryResult = {
      query,
      answer,
      reasoning,
      sources: results,
      entities: Array.from(entities).slice(0, 10),
      confidence: results.length > 0 ? Math.min(results[0].score * 100, 95) : 20,
      processingTime: Date.now() - start,
    }

    return result
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
    db.deleteSource(id)
    return true
  })

  ipcMain.handle('sources:sync', async (_, id: string) => {
    const source = db.getSource(id)
    if (!source) throw new Error('Source not found')

    const onStatus = (status: unknown) => {
      mainWindow?.webContents.send('processing:status', status)
    }

    ingestion.ingestSource(source, onStatus).then(count => {
      mainWindow?.webContents.send('source:synced', { id, count })
    }).catch(err => {
      mainWindow?.webContents.send('source:error', { id, error: err.message })
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

    return true
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
}
