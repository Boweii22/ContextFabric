import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname, basename, dirname } from 'path'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import chokidar, { FSWatcher } from 'chokidar'
import type { DatabaseService } from './database'
import type { OllamaService } from './ollama'
import type { MemoryNode, MemoryEdge, DataSource, Entity, ProcessingStatus } from '../../shared/types'

type StatusCallback = (status: ProcessingStatus) => void

// Extensions indexed in local folders / repos
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
  '.json', '.yaml', '.yml', '.toml', '.env.example', '.sh', '.bash',
  '.css', '.scss', '.html', '.xml', '.csv', '.sql', '.graphql',
])
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.sh', '.bash', '.sql'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out',
  '__pycache__', 'venv', '.venv', '.cache', 'coverage', '.turbo'])

export class IngestionService {
  private enrichmentQueue: Array<{ node: MemoryNode; source: DataSource }> = []
  private enriching = false
  private queryActive = false   // pauses enrichment while user is querying
  private watchers = new Map<string, FSWatcher>()   // sourceId → watcher

  setQueryActive(active: boolean): void {
    this.queryActive = active
    if (active) {
      // Immediately cancel any in-flight enrichment Ollama request
      // so the query doesn't have to wait for it to finish
      this.ollama.abortEnrichment()
    }
  }

  constructor(
    private db: DatabaseService,
    private ollama: OllamaService
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  async ingestSource(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    this.db.updateSourceStatus(source.id, 'indexing')

    try {
      let count = 0

      // If a file-type source was pointed at a directory, treat it as a local folder
      let resolvedType = source.type
      try {
        if (statSync(source.path).isDirectory() &&
            (source.type === 'claude_export' || source.type === 'chatgpt_export' ||
             source.type === 'markdown' || source.type === 'pdf')) {
          console.warn(`[Ingestion] "${source.name}" path is a directory — switching to local_folder ingestion`)
          resolvedType = 'local_folder'
        }
      } catch { /* path doesn't exist — let the specific handler throw a clear error */ }

      switch (resolvedType) {
        case 'claude_export':    count = await this.ingestClaudeExport(source, onStatus); break
        case 'chatgpt_export':   count = await this.ingestChatGPTExport(source, onStatus); break
        case 'local_folder':
        case 'vscode_workspace': count = await this.ingestLocalFolder(source, onStatus); break
        case 'markdown':         count = await this.ingestMarkdownFile(source, onStatus); break
        case 'pdf':              count = await this.ingestPDF(source, onStatus); break
        case 'github_repo':      count = await this.ingestGitHubRepo(source, onStatus); break
        case 'notion_export':    count = await this.ingestNotionExport(source, onStatus); break
        default:                 count = await this.ingestLocalFolder(source, onStatus); break
      }
      this.db.updateSourceStatus(source.id, 'ready', count)

      // Start watching for live changes on folder-based sources
      if (source.enabled) this.watchSource(source)

      return count
    } catch (err) {
      console.error('[Ingestion] Error:', err)
      this.db.updateSourceStatus(source.id, 'error')
      throw err
    }
  }

  stopWatcher(sourceId: string): void {
    const w = this.watchers.get(sourceId)
    if (w) { w.close(); this.watchers.delete(sourceId) }
  }

  stopAllWatchers(): void {
    for (const [id] of this.watchers) this.stopWatcher(id)
  }

  // ─── Claude export ─────────────────────────────────────────────────────────

  private async ingestClaudeExport(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const raw = JSON.parse(readFileSync(source.path, 'utf-8'))
    const conversations: unknown[] = Array.isArray(raw) ? raw : [raw]
    const nodes: MemoryNode[] = []

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i] as Record<string, unknown>
      const messages = (conv['messages'] as unknown[]) || []
      const title = (conv['title'] as string) || `Conversation ${i + 1}`
      const ts = conv['created_at'] ? new Date(conv['created_at'] as string).getTime() : Date.now()

      let text = ''
      for (const msg of messages) {
        const m = msg as Record<string, unknown>
        const role = (m['role'] as string) === 'human' ? 'User' : 'Assistant'
        const content = this.extractMessageContent(m['content'])
        if (content) text += `${role}: ${content}\n\n`
      }
      if (text.length < 50) continue

      for (const [ci, chunk] of this.chunkText(text, 4000).entries()) {
        nodes.push(this.makeNode(chunk, 'conversation', source, ts,
          { title: `${title}${ci > 0 ? ` (${ci + 1})` : ''}`, chunkIndex: ci, conversationIndex: i }))
      }

      onStatus?.({ sourceId: source.id, phase: 'parsing',
        progress: i + 1, total: conversations.length,
        message: `Parsing ${i + 1}/${conversations.length} conversations…`, startTime: Date.now() })
    }

    return this.processNodes(nodes, source, onStatus)
  }

  // ─── ChatGPT export ────────────────────────────────────────────────────────

  private async ingestChatGPTExport(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const raw = JSON.parse(readFileSync(source.path, 'utf-8'))
    const conversations: unknown[] = Array.isArray(raw) ? raw : [raw]
    const nodes: MemoryNode[] = []

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i] as Record<string, unknown>
      const title = (conv['title'] as string) || `Conversation ${i + 1}`
      const ts = ((conv['create_time'] as number) || 0) * 1000 || Date.now()

      // ChatGPT uses a node-based mapping tree
      let text = ''
      const mapping = (conv['mapping'] as Record<string, unknown>) || {}
      // Walk the tree in order using parent refs
      const messageNodes = Object.values(mapping)
        .map(v => v as Record<string, unknown>)
        .filter(v => v['message'])
        .sort((a, b) => {
          const ta = ((a['message'] as Record<string,unknown>)?.['create_time'] as number) || 0
          const tb = ((b['message'] as Record<string,unknown>)?.['create_time'] as number) || 0
          return ta - tb
        })

      for (const v of messageNodes) {
        const msg = v['message'] as Record<string, unknown>
        const author = ((msg['author'] as Record<string, unknown>)?.['role'] as string) || ''
        if (author === 'system') continue
        const parts = ((msg['content'] as Record<string, unknown>)?.['parts'] as unknown[]) || []
        const content = parts
          .map(p => typeof p === 'string' ? p : (p as Record<string,unknown>)?.['text'] || '')
          .join('\n').trim()
        if (content) text += `${author === 'user' ? 'User' : 'Assistant'}: ${content}\n\n`
      }

      if (text.length < 50) continue

      for (const [ci, chunk] of this.chunkText(text, 4000).entries()) {
        nodes.push(this.makeNode(chunk, 'conversation', source, ts,
          { title: `${title}${ci > 0 ? ` (${ci + 1})` : ''}`, chunkIndex: ci, conversationIndex: i }))
      }
    }

    return this.processNodes(nodes, source, onStatus)
  }

  // ─── Local folder ──────────────────────────────────────────────────────────

  private async ingestLocalFolder(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const nodes: MemoryNode[] = []
    onStatus?.({ sourceId: source.id, phase: 'parsing', progress: 0, total: 1,
      message: 'Scanning directory…', startTime: Date.now() })

    this.walkDir(source.path, (fullPath, stat) => {
      const ext = extname(fullPath).toLowerCase()
      if (!TEXT_EXTENSIONS.has(ext)) return
      if (Number(stat?.size ?? 0) > 300_000) return
      try {
        const content = readFileSync(fullPath, 'utf-8')
        if (content.trim().length < 20) return
        const isCode = CODE_EXTENSIONS.has(ext)
        const mtimeMs = Number(stat?.mtimeMs ?? Date.now())
        for (const [ci, chunk] of this.chunkText(content, isCode ? 3000 : 4000).entries()) {
          nodes.push(this.makeNode(chunk, isCode ? 'code' : 'document', source, mtimeMs, {
            title: `${basename(fullPath)}${ci > 0 ? ` (${ci + 1})` : ''}`,
            path: fullPath, ext, chunkIndex: ci,
          }))
        }
      } catch { /* skip unreadable */ }
    })

    return this.processNodes(nodes, source, onStatus)
  }

  // ─── Markdown file ─────────────────────────────────────────────────────────

  private async ingestMarkdownFile(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const content = readFileSync(source.path, 'utf-8')
    const stat = statSync(source.path)
    const nodes = this.chunkText(content, 2000).map((chunk, ci) =>
      this.makeNode(chunk, 'document', source, stat.mtimeMs, {
        title: `${basename(source.path)}${ci > 0 ? ` (${ci + 1})` : ''}`,
        path: source.path, chunkIndex: ci,
      })
    )
    return this.processNodes(nodes, source, onStatus)
  }

  // ─── PDF ───────────────────────────────────────────────────────────────────

  private async ingestPDF(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    let text = ''
    try {
      const pdfParse = require('pdf-parse')
      const data = await pdfParse(readFileSync(source.path))
      text = data.text
    } catch (err) {
      throw new Error(`PDF parse failed: ${err instanceof Error ? err.message : err}`)
    }
    const stat = statSync(source.path)
    const nodes = this.chunkText(text, 4000).map((chunk, ci) =>
      this.makeNode(chunk, 'document', source, stat.mtimeMs, {
        title: `${basename(source.path)} — part ${ci + 1}`,
        path: source.path, chunkIndex: ci,
      })
    )
    return this.processNodes(nodes, source, onStatus)
  }

  // ─── GitHub repo ───────────────────────────────────────────────────────────
  // Indexes: (1) source files, (2) commit history with messages

  private async ingestGitHubRepo(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const nodes: MemoryNode[] = []

    // 1. Source files (same as local folder)
    onStatus?.({ sourceId: source.id, phase: 'parsing', progress: 0, total: 1,
      message: 'Scanning repo files…', startTime: Date.now() })

    this.walkDir(source.path, (fullPath, stat) => {
      const ext = extname(fullPath).toLowerCase()
      if (!TEXT_EXTENSIONS.has(ext)) return
      if (Number(stat?.size ?? 0) > 300_000) return
      try {
        const content = readFileSync(fullPath, 'utf-8')
        if (content.trim().length < 20) return
        const isCode = CODE_EXTENSIONS.has(ext)
        const mtimeMs = Number(stat?.mtimeMs ?? Date.now())
        for (const [ci, chunk] of this.chunkText(content, isCode ? 3000 : 4000).entries()) {
          nodes.push(this.makeNode(chunk, isCode ? 'code' : 'document', source, mtimeMs, {
            title: `${basename(fullPath)}${ci > 0 ? ` (${ci + 1})` : ''}`,
            path: fullPath, ext, chunkIndex: ci,
          }))
        }
      } catch { /* skip */ }
    })

    // 2. Git commit history
    onStatus?.({ sourceId: source.id, phase: 'parsing', progress: 0, total: 1,
      message: 'Reading commit history…', startTime: Date.now() })

    try {
      const commits = this.parseGitLog(source.path)
      onStatus?.({ sourceId: source.id, phase: 'parsing', progress: 0, total: 1,
        message: `Found ${commits.length} commits`, startTime: Date.now() })

      for (const commit of commits) {
        // Skip pure chore commits with no body
        if (!commit.body && commit.subject.length < 10) continue

        const text = [
          `Commit: ${commit.hash.substring(0, 8)}`,
          `Author: ${commit.author}`,
          `Date: ${new Date(commit.timestamp).toLocaleDateString()}`,
          `Message: ${commit.subject}`,
          commit.body ? `\n${commit.body}` : '',
          commit.filesChanged.length
            ? `\nFiles changed: ${commit.filesChanged.slice(0, 10).join(', ')}`
            : '',
        ].filter(Boolean).join('\n')

        nodes.push(this.makeNode(text, 'document', source, commit.timestamp, {
          title: `Commit: ${commit.subject.substring(0, 60)}`,
          commitHash: commit.hash,
          author: commit.author,
          isCommit: true,
        }))
      }
    } catch (err) {
      // Not a git repo or git not available — that's fine, just skip commits
      console.warn('[Ingestion] Git log failed (not a git repo?):', err instanceof Error ? err.message : err)
    }

    return this.processNodes(nodes, source, onStatus)
  }

  private parseGitLog(repoPath: string): Array<{
    hash: string; author: string; timestamp: number
    subject: string; body: string; filesChanged: string[]
  }> {
    // Get commits with separator format
    const SEP = '---COMMIT---'
    const FORMAT = `${SEP}%n%H%n%an%n%ai%n%s%n%b%n---FILES---`

    const log = execSync(
      `git log --format="${FORMAT}" --name-only --max-count=500`,
      { cwd: repoPath, encoding: 'utf-8', timeout: 15000 }
    )

    const commits: ReturnType<typeof this.parseGitLog> = []
    const blocks = log.split(SEP).filter(b => b.trim())

    for (const block of blocks) {
      try {
        const [, hash, author, dateStr, subject, ...rest] = block.split('\n')
        if (!hash?.trim()) continue

        const filesMarker = rest.indexOf('---FILES---')
        const bodyLines = filesMarker > 0 ? rest.slice(0, filesMarker) : []
        const fileLines = filesMarker >= 0 ? rest.slice(filesMarker + 1) : []

        commits.push({
          hash: hash.trim(),
          author: author?.trim() || 'Unknown',
          timestamp: new Date(dateStr?.trim() || Date.now()).getTime(),
          subject: subject?.trim() || '',
          body: bodyLines.join('\n').trim(),
          filesChanged: fileLines.map(f => f.trim()).filter(Boolean),
        })
      } catch { /* skip malformed commit */ }
    }

    return commits
  }

  // ─── Notion export ─────────────────────────────────────────────────────────
  // Handles: .md files, .html files (stripped), .csv databases

  private async ingestNotionExport(source: DataSource, onStatus?: StatusCallback): Promise<number> {
    const nodes: MemoryNode[] = []
    onStatus?.({ sourceId: source.id, phase: 'parsing', progress: 0, total: 1,
      message: 'Scanning Notion export…', startTime: Date.now() })

    this.walkDir(source.path, (fullPath, stat) => {
      const ext = extname(fullPath).toLowerCase()
      const mtimeMs = Number(stat?.mtimeMs ?? Date.now())

      try {
        if (ext === '.md') {
          // Standard markdown pages
          const content = readFileSync(fullPath, 'utf-8')
          if (content.trim().length < 20) return
          for (const [ci, chunk] of this.chunkText(content, 2000).entries()) {
            nodes.push(this.makeNode(chunk, 'document', source, mtimeMs, {
              title: `${this.notionPageTitle(fullPath)}${ci > 0 ? ` (${ci + 1})` : ''}`,
              path: fullPath, chunkIndex: ci, format: 'markdown',
            }))
          }

        } else if (ext === '.html') {
          // Strip HTML tags → plain text
          const raw = readFileSync(fullPath, 'utf-8')
          const text = this.htmlToText(raw)
          if (text.length < 30) return
          for (const [ci, chunk] of this.chunkText(text, 4000).entries()) {
            nodes.push(this.makeNode(chunk, 'document', source, mtimeMs, {
              title: `${this.notionPageTitle(fullPath)}${ci > 0 ? ` (${ci + 1})` : ''}`,
              path: fullPath, chunkIndex: ci, format: 'html',
            }))
          }

        } else if (ext === '.csv') {
          // Database tables — convert rows to readable text
          const text = this.csvToText(readFileSync(fullPath, 'utf-8'))
          if (text.length < 20) return
          for (const [ci, chunk] of this.chunkText(text, 4000).entries()) {
            nodes.push(this.makeNode(chunk, 'document', source, mtimeMs, {
              title: `${basename(fullPath, '.csv')} database${ci > 0 ? ` (${ci + 1})` : ''}`,
              path: fullPath, chunkIndex: ci, format: 'csv',
            }))
          }
        }
      } catch { /* skip unreadable */ }
    })

    return this.processNodes(nodes, source, onStatus)
  }

  // HTML → plain text (no external deps)
  private htmlToText(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  // CSV → human-readable text (each row = "Field: value, Field: value")
  private csvToText(csv: string): string {
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return csv
    const headers = this.parseCSVRow(lines[0])
    const rows = lines.slice(1).map(line => {
      const values = this.parseCSVRow(line)
      return headers
        .map((h, i) => `${h}: ${values[i] || ''}`)
        .filter(entry => !entry.endsWith(': '))
        .join(' | ')
    }).filter(row => row.trim())
    return rows.join('\n')
  }

  private parseCSVRow(row: string): string[] {
    const result: string[] = []
    let current = '', inQuote = false
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '"') { inQuote = !inQuote; continue }
      if (row[i] === ',' && !inQuote) { result.push(current.trim()); current = ''; continue }
      current += row[i]
    }
    result.push(current.trim())
    return result
  }

  private notionPageTitle(filePath: string): string {
    // Notion exports filenames as "Page Title xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.md"
    // Strip the UUID suffix
    const name = basename(filePath, extname(filePath))
    return name.replace(/\s+[a-f0-9]{32}$/, '').trim() || name
  }

  // ─── Live file watcher ─────────────────────────────────────────────────────

  watchSource(source: DataSource): void {
    // Only watch folder-based sources
    const watchable = ['local_folder', 'github_repo', 'vscode_workspace', 'notion_export', 'markdown']
    if (!watchable.includes(source.type)) return
    if (!existsSync(source.path)) return

    // Stop existing watcher for this source
    this.stopWatcher(source.id)

    const isFile = statSync(source.path).isFile()
    const watchPath = isFile ? source.path : source.path

    const watcher = chokidar.watch(watchPath, {
      ignored: [
        /(^|[/\\])\../,   // hidden files
        /node_modules/,
        /\.git/,
        /dist\/|build\/|\.next\//,
        /__pycache__/,
        /venv\//,
      ],
      persistent: true,
      ignoreInitial: true,   // don't fire for existing files on start
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
      depth: 6,
    })

    // Debounce map: path → timeout
    const pending = new Map<string, ReturnType<typeof setTimeout>>()

    const handle = (eventPath: string, event: 'add' | 'change' | 'unlink') => {
      const ext = extname(eventPath).toLowerCase()
      if (!TEXT_EXTENSIONS.has(ext) && ext !== '.html' && ext !== '.csv') return

      // Debounce: wait 2s after last change to a file before re-indexing
      clearTimeout(pending.get(eventPath))
      pending.set(eventPath, setTimeout(() => {
        pending.delete(eventPath)
        if (event === 'unlink') {
          this.removeFileNodes(source.id, eventPath)
        } else {
          this.reindexFile(source, eventPath).catch(e =>
            console.error('[Watcher] Re-index failed:', e)
          )
        }
      }, 2000))
    }

    watcher
      .on('add', path => handle(path, 'add'))
      .on('change', path => handle(path, 'change'))
      .on('unlink', path => handle(path, 'unlink'))
      .on('error', err => console.error('[Watcher]', err))

    this.watchers.set(source.id, watcher)
    console.log(`[Watcher] Watching "${source.name}" at ${source.path}`)
  }

  private removeFileNodes(sourceId: string, filePath: string): void {
    // Soft-delete nodes whose metadata path matches the removed file
    const nodes = this.db.getNodesBySource(sourceId)
    for (const node of nodes) {
      const meta = node.metadata as Record<string, unknown>
      if (meta?.path === filePath) {
        this.db.deleteNodesBySource(sourceId) // simplified: mark all from source
        // In production you'd do per-file deletion — future enhancement
        break
      }
    }
  }

  private async reindexFile(source: DataSource, filePath: string): Promise<void> {
    const ext = extname(filePath).toLowerCase()
    if (!TEXT_EXTENSIONS.has(ext) && ext !== '.html' && ext !== '.csv') return

    let stat: ReturnType<typeof statSync>
    try { stat = statSync(filePath) } catch { return }

    const embeddingModel = this.db.getAllSettings().embeddingModel || 'nomic-embed-text'
    const nodes: MemoryNode[] = []

    try {
      if (ext === '.html') {
        const text = this.htmlToText(readFileSync(filePath, 'utf-8'))
        for (const [ci, chunk] of this.chunkText(text, 4000).entries()) {
          nodes.push(this.makeNode(chunk, 'document', source, stat.mtimeMs, {
            title: this.notionPageTitle(filePath), path: filePath, chunkIndex: ci,
          }))
        }
      } else if (ext === '.csv') {
        const text = this.csvToText(readFileSync(filePath, 'utf-8'))
        for (const [ci, chunk] of this.chunkText(text, 4000).entries()) {
          nodes.push(this.makeNode(chunk, 'document', source, stat.mtimeMs, {
            title: basename(filePath, '.csv'), path: filePath, chunkIndex: ci,
          }))
        }
      } else {
        const content = readFileSync(filePath, 'utf-8')
        const isCode = CODE_EXTENSIONS.has(ext)
        for (const [ci, chunk] of this.chunkText(content, isCode ? 3000 : 4000).entries()) {
          nodes.push(this.makeNode(chunk, isCode ? 'code' : 'document', source, stat.mtimeMs, {
            title: basename(filePath), path: filePath, ext, chunkIndex: ci,
          }))
        }
      }
    } catch { return }

    if (nodes.length === 0) return

    // Regex entities + save + embed (fast path, no Gemma)
    for (const node of nodes) {
      node.entities = this.ollama.simpleEntityExtract(node.content).map(e => e.name)
    }
    this.db.batchUpsertNodes(nodes)
    this.saveEntitiesBulk(nodes)

    // Fast hash embed for immediate searchability
    for (const node of nodes) {
      const text = `${node.title} ${node.entities.join(' ')} ${node.content.substring(0, 600)}`
      this.db.saveEmbedding(node.id, this.ollama.fastEmbed(text), embeddingModel)
    }

    // Update node count on source
    const count = this.db.getNodesBySource(source.id).length
    this.db.updateSourceStatus(source.id, 'ready', count)
    console.log(`[Watcher] Re-indexed "${basename(filePath)}" (${nodes.length} chunks)`)
  }

  // Restore watchers on app startup for all enabled, ready sources
  watchAllSources(): void {
    const sources = this.db.getSources()
    for (const source of sources) {
      if (source.enabled && source.status === 'ready') {
        this.watchSource(source)
      }
    }
  }

  // ─── Core processing ───────────────────────────────────────────────────────

  private async processNodes(nodes: MemoryNode[], source: DataSource, onStatus?: StatusCallback): Promise<number> {
    if (nodes.length === 0) return 0

    // Cap to 500 nodes per source so large repos don't run forever
    const capped = nodes.slice(0, 500)
    const embeddingModel = this.db.getAllSettings().embeddingModel || 'nomic-embed-text'

    // 1. Regex entities — instant
    for (const node of capped) {
      node.entities = this.ollama.simpleEntityExtract(node.content).map(e => e.name)
    }

    // 2. Bulk save all nodes + fast hash embeddings in one transaction pass
    this.db.batchUpsertNodes(capped)
    this.saveEntitiesBulk(capped)

    // 3. Fast hash embeddings — all in a single DB transaction, zero HTTP calls
    const embItems = capped.map(node => ({
      nodeId: node.id,
      embedding: this.ollama.fastEmbed(
        `${node.title} ${node.entities.join(' ')} ${node.content.substring(0, 600)}`
      ),
    }))
    this.db.batchSaveEmbeddings(embItems, embeddingModel)

    onStatus?.({ sourceId: source.id, phase: 'embedding',
      progress: capped.length, total: capped.length,
      message: `Saved ${capped.length} nodes — upgrading embeddings in background`,
      startTime: Date.now() })

    // 4. Build graph edges — entity co-occurrence, file structure, code deps
    this.buildRelationships(capped)

    // 5. Queue ALL nodes for background Gemma enrichment + real embed upgrade
    for (const node of capped) {
      this.enrichmentQueue.push({ node, source })
    }
    this.runEnrichmentQueue()

    return capped.length
  }

  // ─── Edge / relationship building ──────────────────────────────────────────

  private buildRelationships(nodes: MemoryNode[]): void {
    const edges: MemoryEdge[] = []

    // ── 1. "related" — entity co-occurrence across nodes ──────────────────────
    // Build entity → [nodeId] map
    const entityToNodes = new Map<string, string[]>()
    for (const node of nodes) {
      for (const entity of node.entities) {
        const key = entity.toLowerCase()
        if (!entityToNodes.has(key)) entityToNodes.set(key, [])
        entityToNodes.get(key)!.push(node.id)
      }
    }

    // Count shared entities between every pair
    const pairWeight = new Map<string, number>()
    for (const [, nodeIds] of entityToNodes) {
      // Skip entities that appear in too many nodes — not meaningful as a link
      if (nodeIds.length < 2 || nodeIds.length > 30) continue
      for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
          const key = nodeIds[i] < nodeIds[j]
            ? `${nodeIds[i]}:${nodeIds[j]}`
            : `${nodeIds[j]}:${nodeIds[i]}`
          pairWeight.set(key, (pairWeight.get(key) || 0) + 1)
        }
      }
    }

    // Only keep pairs sharing ≥2 entities, cap total related edges at 300
    const relatedPairs = [...pairWeight.entries()]
      .filter(([, w]) => w >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 300)

    for (const [pair, weight] of relatedPairs) {
      const [source, target] = pair.split(':')
      edges.push({
        id: uuidv4(), source, target,
        type: 'related',
        weight: Math.min(weight / 6, 1),
        label: `${weight} shared topics`,
        metadata: {},
      })
    }

    // ── 2. "belongs_to" — consecutive chunks of the same file ─────────────────
    // Group nodes by their source file path (metadata.path)
    const fileGroups = new Map<string, MemoryNode[]>()
    for (const node of nodes) {
      const path = (node.metadata as Record<string, unknown>).path as string | undefined
      if (!path) continue
      if (!fileGroups.has(path)) fileGroups.set(path, [])
      fileGroups.get(path)!.push(node)
    }

    for (const [, fileNodes] of fileGroups) {
      if (fileNodes.length < 2) continue
      const sorted = fileNodes.sort((a, b) => {
        const ai = ((a.metadata as Record<string, unknown>).chunkIndex as number) ?? 0
        const bi = ((b.metadata as Record<string, unknown>).chunkIndex as number) ?? 0
        return ai - bi
      })
      for (let i = 0; i < sorted.length - 1; i++) {
        edges.push({
          id: uuidv4(),
          source: sorted[i].id,
          target: sorted[i + 1].id,
          type: 'belongs_to',
          weight: 0.4,
          label: 'continues in',
          metadata: {},
        })
      }
    }

    // ── 3. "depends_on" — code imports referencing other indexed file titles ───
    const codeNodes = nodes.filter(n => n.type === 'code')
    const allTitles = new Map(nodes.map(n => [n.title.toLowerCase().replace(/\s*\(\d+\)$/, ''), n.id]))

    for (const codeNode of codeNodes) {
      const importLines = codeNode.content
        .split('\n')
        .filter(l => /^(import |from |require\()/.test(l.trim()))

      for (const line of importLines) {
        // Extract the module/file name from the import
        const match = line.match(/['"]([^'"]+)['"]/)?.[1]
        if (!match) continue
        const stem = match.split('/').pop()?.replace(/\.[^.]+$/, '').toLowerCase()
        if (!stem) continue
        const targetId = allTitles.get(stem) || allTitles.get(`${stem}.ts`) || allTitles.get(`${stem}.py`)
        if (targetId && targetId !== codeNode.id) {
          edges.push({
            id: uuidv4(),
            source: codeNode.id,
            target: targetId,
            type: 'depends_on',
            weight: 0.6,
            label: `imports ${stem}`,
            metadata: {},
          })
        }
      }
    }

    if (edges.length > 0) {
      this.db.batchUpsertEdges(edges)
      console.log(`[Graph] Built ${edges.length} edges (related: ${relatedPairs.length}, belongs_to: ${edges.filter(e => e.type === 'belongs_to').length}, depends_on: ${edges.filter(e => e.type === 'depends_on').length})`)
    }
  }

  // ─── Background Gemma enrichment ───────────────────────────────────────────

  private async runEnrichmentQueue(): Promise<void> {
    if (this.enriching || this.enrichmentQueue.length === 0) return
    this.enriching = true

    // Wait 30s after sync before enriching — lets user query without contention
    await new Promise(r => setTimeout(r, 30000))

    while (this.enrichmentQueue.length > 0) {
      // Yield to interactive queries — wait until no query is active
      while (this.queryActive) {
        await new Promise(r => setTimeout(r, 500))
      }
      const item = this.enrichmentQueue.shift()!
      this.ollama.startEnrichmentCall()  // register abort signal before each enrichment
      try { await this.enrichNode(item.node, item.source) } catch { /* never block */ }
      // 2s gap between nodes so Ollama isn't saturated
      await new Promise(r => setTimeout(r, 2000))
    }

    this.enriching = false
  }

  // Cap any single enrichment Gemma call so it can't block Ollama for the user
  private withTimeout<T>(promise: Promise<T>, ms = 25000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('enrichment timeout')), ms))
    ])
  }

  private async enrichNode(node: MemoryNode, source: DataSource): Promise<void> {
    const embeddingModel = this.db.getAllSettings().embeddingModel || 'nomic-embed-text'

    // Summarize long content
    if (!node.summary && node.content.length > 800) {
      try { node.summary = await this.withTimeout(this.ollama.summarize(node.content, 150)) } catch { /* skip */ }
    }

    // Decision extraction for non-code content
    if (node.type !== 'code') {
      try {
        const decision = await this.withTimeout(this.ollama.extractDecision(node.content))
        if (decision.isDecision && decision.decision) {
          const eventId = uuidv4()
          this.db.upsertTimelineEvent({
            id: eventId, nodeId: node.id,
            title: decision.decision,
            description: [decision.reasoning,
              decision.alternatives?.length ? `Alternatives: ${decision.alternatives.join(', ')}` : '',
            ].filter(Boolean).join(' — '),
            timestamp: node.timestamp, type: 'decision',
            sourceId: source.id, sourceName: source.name,
            relatedEntities: node.entities, significance: 'high',
          })
          // Link this node to others that share its entities using "decided_by"
          const related = this.db.getEdgesForNode(node.id)
          for (const edge of related.slice(0, 3)) {
            const otherId = edge.source === node.id ? edge.target : edge.source
            this.db.upsertEdge({
              id: uuidv4(), source: node.id, target: otherId,
              type: 'decided_by', weight: 0.8,
              label: decision.decision?.substring(0, 40),
              metadata: { decisionEventId: eventId },
            })
          }
        }
      } catch { /* skip */ }
    }

    // AI entity extraction
    try {
      const ai = await this.withTimeout(this.ollama.extractEntities(node.content))
      node.entities = [...new Set([...node.entities, ...ai.map(e => e.name)])].slice(0, 10)
      this.saveEntitiesBulk([node])
    } catch { /* skip */ }

    // Always upgrade from fast hash embed to real semantic embed
    this.db.upsertNode(node)
    try {
      const text = [node.title, node.summary || '', node.entities.join(', '), node.content.substring(0, 600)].join('\n')
      const emb = await this.ollama.embed(text)
      if (emb.length > 0) this.db.saveEmbedding(node.id, emb, embeddingModel)
    } catch { /* skip */ }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  // Deterministic ID: same source + file + chunk = same ID on every sync → no duplicates
  private stableId(...parts: string[]): string {
    const hash = createHash('sha1').update(parts.join(':::')).digest('hex')
    return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`
  }

  private makeNode(
    content: string,
    type: MemoryNode['type'],
    source: DataSource,
    timestamp: number,
    meta: Record<string, unknown>
  ): MemoryNode {
    const { title, ...rest } = meta
    const path = meta.path as string | undefined
    const chunkIndex = meta.chunkIndex as number | undefined
    const convIndex = meta.conversationIndex as number | undefined

    const id = path !== undefined && chunkIndex !== undefined
      ? this.stableId(source.id, path, String(chunkIndex))
      : convIndex !== undefined && chunkIndex !== undefined
        ? this.stableId(source.id, String(convIndex), String(chunkIndex))
        : uuidv4()

    return {
      id,
      title: (title as string) || basename(source.path),
      content,
      type,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      timestamp,
      tags: [],
      entities: [],
      metadata: rest,
    }
  }

  private walkDir(dir: string, cb: (path: string, stat: ReturnType<typeof statSync>) => void, depth = 0): void {
    if (depth > 6 || !existsSync(dir)) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
        if (SKIP_DIRS.has(entry.name)) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { this.walkDir(full, cb, depth + 1); continue }
        if (entry.isFile()) {
          try { cb(full, statSync(full)) } catch { /* skip */ }
        }
      }
    } catch { /* skip unreadable dir */ }
  }

  private saveEntitiesBulk(nodes: MemoryNode[]): void {
    const existing = new Map(this.db.getEntities(5000).map(e => [e.name.toLowerCase(), e]))
    const toUpsert = new Map<string, Entity>()

    for (const node of nodes) {
      for (const name of node.entities) {
        const key = name.toLowerCase()
        const found = existing.get(key) || toUpsert.get(key)
        if (found) {
          found.mentions++
          found.lastSeen = Math.max(found.lastSeen, node.timestamp)
          if (!found.nodeIds.includes(node.id)) found.nodeIds.push(node.id)
          toUpsert.set(key, found)
        } else {
          const entity: Entity = {
            id: uuidv4(), name, type: 'technology',
            mentions: 1, firstSeen: node.timestamp, lastSeen: node.timestamp, nodeIds: [node.id],
          }
          toUpsert.set(key, entity)
          existing.set(key, entity)
        }
      }
    }
    this.db.batchUpsertEntities(Array.from(toUpsert.values()))
  }

  private chunkText(text: string, maxSize: number): string[] {
    if (text.length <= maxSize) return [text]
    const chunks: string[] = []
    let current = ''
    for (const para of text.split(/\n\n+/)) {
      if (current.length + para.length > maxSize && current.length > 0) {
        chunks.push(current.trim()); current = para
      } else {
        current += (current ? '\n\n' : '') + para
      }
    }
    if (current.trim()) chunks.push(current.trim())
    const result: string[] = []
    for (const c of chunks) {
      if (c.length > maxSize) {
        for (let i = 0; i < c.length; i += maxSize) result.push(c.slice(i, i + maxSize))
      } else result.push(c)
    }
    return result.filter(c => c.trim().length > 20)
  }

  private extractMessageContent(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map((c: unknown) => {
        if (typeof c === 'string') return c
        if (typeof c === 'object' && c !== null) {
          const o = c as Record<string, unknown>
          return o['text'] || o['content'] || ''
        }
        return ''
      }).join('\n')
    }
    return ''
  }
}
