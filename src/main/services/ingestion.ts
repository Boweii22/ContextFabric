import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DatabaseService } from './database'
import type { OllamaService } from './ollama'
import type { MemoryNode, DataSource, TimelineEvent, Entity, ProcessingStatus } from '../../shared/types'

type StatusCallback = (status: ProcessingStatus) => void

export class IngestionService {
  constructor(
    private db: DatabaseService,
    private ollama: OllamaService
  ) {}

  async ingestSource(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    this.db.updateSourceStatus(source.id, 'indexing')
    let nodeCount = 0

    try {
      switch (source.type) {
        case 'claude_export':
          nodeCount = await this.ingestClaudeExport(source, onStatus)
          break
        case 'chatgpt_export':
          nodeCount = await this.ingestChatGPTExport(source, onStatus)
          break
        case 'local_folder':
        case 'vscode_workspace':
          nodeCount = await this.ingestLocalFolder(source, onStatus)
          break
        case 'markdown':
          nodeCount = await this.ingestMarkdownFile(source, onStatus)
          break
        case 'pdf':
          nodeCount = await this.ingestPDF(source, onStatus)
          break
        case 'github_repo':
          nodeCount = await this.ingestGitHubRepo(source, onStatus)
          break
        case 'notion_export':
          nodeCount = await this.ingestNotionExport(source, onStatus)
          break
        default:
          nodeCount = await this.ingestLocalFolder(source, onStatus)
      }

      this.db.updateSourceStatus(source.id, 'ready', nodeCount)
      return nodeCount
    } catch (err) {
      console.error('[Ingestion] Error:', err)
      this.db.updateSourceStatus(source.id, 'error')
      throw err
    }
  }

  private async ingestClaudeExport(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const content = readFileSync(source.path, 'utf-8')
    let data: unknown

    try {
      data = JSON.parse(content)
    } catch {
      throw new Error('Invalid Claude export file')
    }

    const conversations: unknown[] = Array.isArray(data) ? data : [data]
    const nodes: MemoryNode[] = []

    onStatus?.({
      sourceId: source.id,
      phase: 'parsing',
      progress: 0,
      total: conversations.length,
      message: `Parsing ${conversations.length} conversations...`,
      startTime: Date.now(),
    })

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i] as Record<string, unknown>
      const messages = (conv['messages'] as unknown[]) || []
      const title = (conv['title'] as string) || `Conversation ${i + 1}`
      const createdAt = conv['created_at'] ? new Date(conv['created_at'] as string).getTime() : Date.now()

      let fullContent = ''
      for (const msg of messages) {
        const m = msg as Record<string, unknown>
        const role = m['role'] as string
        const content = this.extractMessageContent(m['content'])
        if (content) {
          fullContent += `${role === 'human' ? 'User' : 'Assistant'}: ${content}\n\n`
        }
      }

      if (fullContent.length < 50) continue

      const chunks = this.chunkText(fullContent, 2000)
      for (let ci = 0; ci < chunks.length; ci++) {
        const node: MemoryNode = {
          id: uuidv4(),
          title: chunks.length > 1 ? `${title} (Part ${ci + 1})` : title,
          content: chunks[ci],
          type: 'conversation',
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          timestamp: createdAt,
          tags: [],
          entities: [],
          metadata: { conversationIndex: i, chunkIndex: ci, totalChunks: chunks.length },
        }
        nodes.push(node)
      }

      onStatus?.({
        sourceId: source.id,
        phase: 'parsing',
        progress: i + 1,
        total: conversations.length,
        message: `Parsed conversation: ${title}`,
        startTime: Date.now(),
      })
    }

    return await this.processNodes(nodes, source, onStatus)
  }

  private async ingestChatGPTExport(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const content = readFileSync(source.path, 'utf-8')
    let data: unknown

    try {
      data = JSON.parse(content)
    } catch {
      throw new Error('Invalid ChatGPT export file')
    }

    const conversations: unknown[] = Array.isArray(data) ? data : [data]
    const nodes: MemoryNode[] = []

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i] as Record<string, unknown>
      const title = (conv['title'] as string) || `Conversation ${i + 1}`
      const createTime = (conv['create_time'] as number) * 1000 || Date.now()

      let fullContent = ''
      const mapping = conv['mapping'] as Record<string, unknown> || {}
      for (const nodeData of Object.values(mapping)) {
        const n = nodeData as Record<string, unknown>
        const message = n['message'] as Record<string, unknown> | null
        if (!message) continue
        const author = (message['author'] as Record<string, unknown>)?.role as string
        const parts = (message['content'] as Record<string, unknown>)?.parts as unknown[] || []
        const text = parts.join('\n')
        if (text.trim()) {
          fullContent += `${author === 'user' ? 'User' : 'Assistant'}: ${text}\n\n`
        }
      }

      if (fullContent.length < 50) continue

      const chunks = this.chunkText(fullContent, 2000)
      for (let ci = 0; ci < chunks.length; ci++) {
        nodes.push({
          id: uuidv4(),
          title: chunks.length > 1 ? `${title} (Part ${ci + 1})` : title,
          content: chunks[ci],
          type: 'conversation',
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          timestamp: createTime,
          tags: [],
          entities: [],
          metadata: { conversationIndex: i, chunkIndex: ci },
        })
      }
    }

    return await this.processNodes(nodes, source, onStatus)
  }

  private async ingestLocalFolder(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const nodes: MemoryNode[] = []
    const extensions = ['.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.json', '.yaml', '.yml', '.toml', '.env.example']

    const walkDir = (dir: string, depth = 0): void => {
      if (depth > 6) return
      if (!existsSync(dir)) return

      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
        if (['node_modules', '.git', 'dist', 'build', '.next', 'out', '__pycache__'].includes(entry.name)) continue

        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase()
          if (extensions.includes(ext)) {
            try {
              const stat = statSync(fullPath)
              if (stat.size > 500_000) continue // skip large files

              const content = readFileSync(fullPath, 'utf-8')
              if (content.trim().length < 20) continue

              const isCode = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'].includes(ext)
              const chunks = this.chunkText(content, isCode ? 1500 : 2000)

              for (let ci = 0; ci < chunks.length; ci++) {
                nodes.push({
                  id: uuidv4(),
                  title: chunks.length > 1 ? `${basename(fullPath)} (${ci + 1}/${chunks.length})` : basename(fullPath),
                  content: chunks[ci],
                  type: isCode ? 'code' : 'document',
                  sourceId: source.id,
                  sourceName: source.name,
                  sourceType: source.type,
                  timestamp: stat.mtimeMs,
                  tags: [ext.replace('.', ''), isCode ? 'code' : 'document'],
                  entities: [],
                  metadata: { path: fullPath, ext, size: stat.size, chunkIndex: ci },
                })
              }
            } catch {
              // skip unreadable
            }
          }
        }
      }
    }

    onStatus?.({ sourceId: source.id, phase: 'parsing', progress: 0, total: 1, message: 'Scanning directory...', startTime: Date.now() })
    walkDir(source.path)
    return await this.processNodes(nodes, source, onStatus)
  }

  private async ingestMarkdownFile(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const content = readFileSync(source.path, 'utf-8')
    const stat = statSync(source.path)
    const chunks = this.chunkText(content, 2000)
    const nodes: MemoryNode[] = chunks.map((chunk, i) => ({
      id: uuidv4(),
      title: chunks.length > 1 ? `${basename(source.path)} (${i + 1})` : basename(source.path),
      content: chunk,
      type: 'document' as const,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      timestamp: stat.mtimeMs,
      tags: ['markdown'],
      entities: [],
      metadata: { path: source.path, chunkIndex: i },
    }))
    return await this.processNodes(nodes, source, onStatus)
  }

  private async ingestPDF(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    let text = ''
    try {
      const pdfParse = require('pdf-parse')
      const buffer = readFileSync(source.path)
      const data = await pdfParse(buffer)
      text = data.text
    } catch {
      throw new Error('Failed to parse PDF. Make sure pdf-parse is installed.')
    }

    const chunks = this.chunkText(text, 2000)
    const stat = statSync(source.path)
    const nodes: MemoryNode[] = chunks.map((chunk, i) => ({
      id: uuidv4(),
      title: `${basename(source.path)} — Page chunk ${i + 1}`,
      content: chunk,
      type: 'document' as const,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      timestamp: stat.mtimeMs,
      tags: ['pdf'],
      entities: [],
      metadata: { path: source.path, chunkIndex: i },
    }))
    return await this.processNodes(nodes, source, onStatus)
  }

  private async ingestGitHubRepo(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    // Treat as local folder if it's a local path
    return this.ingestLocalFolder(source, onStatus)
  }

  private async ingestNotionExport(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    // Notion exports are typically a folder of markdown files
    return this.ingestLocalFolder({ ...source, type: 'local_folder' }, onStatus)
  }

  private async processNodes(nodes: MemoryNode[], source: DataSource, onStatus?: StatusCallback): Promise<number> {
    if (nodes.length === 0) return 0

    onStatus?.({
      sourceId: source.id,
      phase: 'chunking',
      progress: 0,
      total: nodes.length,
      message: `Processing ${nodes.length} chunks...`,
      startTime: Date.now(),
    })

    // Batch save nodes first
    this.db.batchUpsertNodes(nodes)

    // Enrich with AI (entities, summaries, embeddings)
    const batchSize = 5
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize)

      await Promise.all(batch.map(async (node) => {
        try {
          // Extract entities
          const rawEntities = await this.ollama.extractEntities(node.content)
          node.entities = rawEntities.map(e => e.name)

          // Update entities table
          for (const { name, type } of rawEntities) {
            const existingEntities = this.db.getEntities(1000)
            const existing = existingEntities.find(e => e.name.toLowerCase() === name.toLowerCase())
            if (existing) {
              existing.mentions++
              existing.lastSeen = node.timestamp
              if (!existing.nodeIds.includes(node.id)) existing.nodeIds.push(node.id)
              this.db.upsertEntity(existing)
            } else {
              this.db.upsertEntity({
                id: uuidv4(),
                name,
                type: type as Entity['type'],
                mentions: 1,
                firstSeen: node.timestamp,
                lastSeen: node.timestamp,
                nodeIds: [node.id],
              })
            }
          }

          // Generate summary for longer content
          if (node.content.length > 500) {
            node.summary = await this.ollama.summarize(node.content)
          }

          // Check for decisions
          const decision = await this.ollama.extractDecision(node.content)
          if (decision.isDecision && decision.decision) {
            const event: TimelineEvent = {
              id: uuidv4(),
              nodeId: node.id,
              title: decision.decision.substring(0, 100),
              description: decision.reasoning || '',
              timestamp: node.timestamp,
              type: 'decision',
              sourceId: source.id,
              sourceName: source.name,
              relatedEntities: node.entities,
              significance: 'high',
            }
            this.db.upsertTimelineEvent(event)
          }

          // Update node with enriched data
          this.db.upsertNode(node)

          // Generate embedding
          const embeddingText = `${node.title}\n${node.summary || ''}\n${node.entities.join(', ')}\n${node.content.substring(0, 1000)}`
          const embedding = await this.ollama.embed(embeddingText)
          if (embedding.length > 0) {
            const settings = this.db.getAllSettings()
            this.db.saveEmbedding(node.id, embedding, settings.embeddingModel || 'nomic-embed-text')
          }
        } catch (err) {
          console.error(`[Ingestion] Failed to enrich node ${node.id}:`, err)
        }
      }))

      onStatus?.({
        sourceId: source.id,
        phase: 'embedding',
        progress: Math.min(i + batchSize, nodes.length),
        total: nodes.length,
        message: `Embedding chunk ${Math.min(i + batchSize, nodes.length)} of ${nodes.length}...`,
        startTime: Date.now(),
      })
    }

    // Build graph edges
    onStatus?.({
      sourceId: source.id,
      phase: 'graphing',
      progress: 0,
      total: nodes.length,
      message: 'Building knowledge graph...',
      startTime: Date.now(),
    })

    await this.buildGraphEdges(nodes, source)

    return nodes.length
  }

  private async buildGraphEdges(nodes: MemoryNode[], source: DataSource): Promise<void> {
    const allEmbeddings = this.db.getAllEmbeddings()
    const embeddingMap = new Map(allEmbeddings.map(e => [e.nodeId, e.embedding]))

    for (let i = 0; i < nodes.length; i++) {
      const nodeA = nodes[i]
      const embA = embeddingMap.get(nodeA.id)
      if (!embA) continue

      for (let j = i + 1; j < Math.min(i + 20, nodes.length); j++) {
        const nodeB = nodes[j]
        const embB = embeddingMap.get(nodeB.id)
        if (!embB) continue

        const similarity = cosineSimilarity(embA, embB)
        if (similarity > 0.75) {
          this.db.upsertEdge({
            id: uuidv4(),
            source: nodeA.id,
            target: nodeB.id,
            type: 'related',
            weight: similarity,
            metadata: { similarity },
          })
        }
      }
    }
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    if (text.length <= maxChunkSize) return [text]

    const chunks: string[] = []
    const paragraphs = text.split(/\n\n+/)
    let currentChunk = ''

    for (const para of paragraphs) {
      if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim())
        currentChunk = para
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para
      }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim())

    // Handle paragraphs that are still too large
    const result: string[] = []
    for (const chunk of chunks) {
      if (chunk.length > maxChunkSize) {
        for (let i = 0; i < chunk.length; i += maxChunkSize) {
          result.push(chunk.slice(i, i + maxChunkSize))
        }
      } else {
        result.push(chunk)
      }
    }

    return result.filter(c => c.trim().length > 20)
  }

  private extractMessageContent(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((c: unknown) => {
          if (typeof c === 'string') return c
          if (typeof c === 'object' && c !== null) {
            const obj = c as Record<string, unknown>
            return obj['text'] || obj['content'] || ''
          }
          return ''
        })
        .join('\n')
    }
    return ''
  }
}

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
