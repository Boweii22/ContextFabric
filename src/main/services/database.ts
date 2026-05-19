import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import type { MemoryNode, MemoryEdge, DataSource, Entity, TimelineEvent, AppSettings, Stats } from '../../shared/types'

const DB_VERSION = 1

export class DatabaseService {
  private db!: Database.Database
  private dbPath: string

  constructor() {
    const userDataPath = app.getPath('userData')
    const dbDir = join(userDataPath, 'data')
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
    this.dbPath = join(dbDir, 'contextfabric.db')
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('cache_size = -64000')
    this.db.pragma('foreign_keys = ON')
    this.runMigrations()
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_nodes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        entities TEXT NOT NULL DEFAULT '[]',
        summary TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        node_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        label TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (source_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS data_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        last_synced INTEGER,
        node_count INTEGER NOT NULL DEFAULT 0,
        color TEXT NOT NULL DEFAULT '#6366F1',
        icon TEXT NOT NULL DEFAULT 'database',
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        mentions INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        node_ids TEXT NOT NULL DEFAULT '[]',
        summary TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS timeline_events (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        related_entities TEXT NOT NULL DEFAULT '[]',
        significance TEXT NOT NULL DEFAULT 'medium',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_source ON memory_nodes(source_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON memory_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_timestamp ON memory_nodes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_timeline_timestamp ON timeline_events(timestamp);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        id UNINDEXED,
        title,
        content,
        tags,
        entities,
        tokenize='porter unicode61'
      );
    `)

    this.initializeDefaultSettings()
  }

  private initializeDefaultSettings(): void {
    const defaults: AppSettings = {
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'gemma4:e4b',
      embeddingModel: 'nomic-embed-text',
      maxContextLength: 8192,
      autoSync: false,
      syncInterval: 3600,
      theme: 'dark',
      privacyMode: false,
      telemetry: false,
      contextPermissions: {},
      encryption: false,
    }

    const upsert = this.db.prepare(
      'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
    )
    for (const [key, value] of Object.entries(defaults)) {
      upsert.run(key, JSON.stringify(value))
    }

    // Always force-update versioned keys so stale defaults are corrected
    this.db.prepare('UPDATE app_settings SET value = ? WHERE key = ? AND value = ?')
      .run(JSON.stringify('gemma4:e4b'), 'ollamaModel', JSON.stringify('gemma3:12b'))
    this.db.prepare('UPDATE app_settings SET value = ? WHERE key = ? AND value = ?')
      .run(JSON.stringify('gemma4:e4b'), 'ollamaModel', JSON.stringify('gemma3:4b'))
  }

  // === NODES ===

  upsertNode(node: MemoryNode): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory_nodes
        (id, title, content, type, source_id, source_name, source_type, timestamp, tags, entities, summary, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      node.id, node.title, node.content, node.type,
      node.sourceId, node.sourceName, node.sourceType,
      node.timestamp, JSON.stringify(node.tags), JSON.stringify(node.entities),
      node.summary || null, JSON.stringify(node.metadata)
    )

    const fts = this.db.prepare(`
      INSERT OR REPLACE INTO nodes_fts (id, title, content, tags, entities)
      VALUES (?, ?, ?, ?, ?)
    `)
    fts.run(
      node.id, node.title, node.content.substring(0, 10000),
      node.tags.join(' '), node.entities.join(' ')
    )
  }

  batchUpsertNodes(nodes: MemoryNode[]): void {
    const tx = this.db.transaction((nodes: MemoryNode[]) => {
      for (const node of nodes) this.upsertNode(node)
    })
    tx(nodes)
  }

  getNode(id: string): MemoryNode | null {
    const row = this.db.prepare('SELECT * FROM memory_nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToNode(row) : null
  }

  getNodes(limit = 100, offset = 0): MemoryNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory_nodes ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Record<string, unknown>[]
    return rows.map(r => this.rowToNode(r))
  }

  getNodesBySource(sourceId: string): MemoryNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory_nodes WHERE source_id = ? ORDER BY timestamp DESC'
    ).all(sourceId) as Record<string, unknown>[]
    return rows.map(r => this.rowToNode(r))
  }

  deleteNodesBySource(sourceId: string): void {
    this.db.prepare('DELETE FROM memory_nodes WHERE source_id = ?').run(sourceId)
  }

  keywordSearch(query: string, limit = 20): Array<{ node: MemoryNode; score: number }> {
    const rows = this.db.prepare(`
      SELECT n.*, bm25(nodes_fts) as score
      FROM nodes_fts f
      JOIN memory_nodes n ON n.id = f.id
      WHERE nodes_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim() + '*', limit) as Array<Record<string, unknown>>

    return rows.map(r => ({
      node: this.rowToNode(r),
      score: Math.abs(r['score'] as number)
    }))
  }

  private rowToNode(row: Record<string, unknown>): MemoryNode {
    return {
      id: row['id'] as string,
      title: row['title'] as string,
      content: row['content'] as string,
      type: row['type'] as MemoryNode['type'],
      sourceId: row['source_id'] as string,
      sourceName: row['source_name'] as string,
      sourceType: row['source_type'] as string,
      timestamp: row['timestamp'] as number,
      tags: JSON.parse(row['tags'] as string || '[]'),
      entities: JSON.parse(row['entities'] as string || '[]'),
      summary: row['summary'] as string | undefined,
      metadata: JSON.parse(row['metadata'] as string || '{}'),
    }
  }

  // === EMBEDDINGS ===

  saveEmbedding(nodeId: string, embedding: number[], model: string): void {
    const buffer = Buffer.from(new Float32Array(embedding).buffer)
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_embeddings (node_id, embedding, dimensions, model)
      VALUES (?, ?, ?, ?)
    `).run(nodeId, buffer, embedding.length, model)
  }

  getEmbedding(nodeId: string): number[] | null {
    const row = this.db.prepare(
      'SELECT embedding, dimensions FROM memory_embeddings WHERE node_id = ?'
    ).get(nodeId) as { embedding: Buffer; dimensions: number } | undefined
    if (!row) return null
    return Array.from(new Float32Array(row.embedding.buffer))
  }

  getAllEmbeddings(): Array<{ nodeId: string; embedding: number[] }> {
    const rows = this.db.prepare(
      'SELECT node_id, embedding FROM memory_embeddings'
    ).all() as Array<{ node_id: string; embedding: Buffer }>
    return rows.map(r => ({
      nodeId: r.node_id,
      embedding: Array.from(new Float32Array(r.embedding.buffer))
    }))
  }

  // === EDGES ===

  upsertEdge(edge: MemoryEdge): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_edges (id, source_id, target_id, type, weight, label, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(edge.id, edge.source, edge.target, edge.type, edge.weight, edge.label || null, JSON.stringify(edge.metadata))
  }

  getEdgesForNode(nodeId: string): MemoryEdge[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_edges WHERE source_id = ? OR target_id = ?
    `).all(nodeId, nodeId) as Record<string, unknown>[]
    return rows.map(r => this.rowToEdge(r))
  }

  getAllEdges(): MemoryEdge[] {
    const rows = this.db.prepare('SELECT * FROM memory_edges').all() as Record<string, unknown>[]
    return rows.map(r => this.rowToEdge(r))
  }

  private rowToEdge(row: Record<string, unknown>): MemoryEdge {
    return {
      id: row['id'] as string,
      source: row['source_id'] as string,
      target: row['target_id'] as string,
      type: row['type'] as MemoryEdge['type'],
      weight: row['weight'] as number,
      label: row['label'] as string | undefined,
      metadata: JSON.parse(row['metadata'] as string || '{}'),
    }
  }

  // === SOURCES ===

  upsertSource(source: DataSource): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO data_sources
        (id, name, type, path, status, last_synced, node_count, color, icon, enabled, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id, source.name, source.type, source.path, source.status,
      source.lastSynced || null, source.nodeCount, source.color, source.icon,
      source.enabled ? 1 : 0, JSON.stringify(source.metadata)
    )
  }

  getSources(): DataSource[] {
    const rows = this.db.prepare('SELECT * FROM data_sources ORDER BY created_at ASC').all() as Record<string, unknown>[]
    return rows.map(r => this.rowToSource(r))
  }

  getSource(id: string): DataSource | null {
    const row = this.db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToSource(row) : null
  }

  deleteSource(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM memory_nodes WHERE source_id = ?').run(id)
      this.db.prepare('DELETE FROM data_sources WHERE id = ?').run(id)
    })()
  }

  updateSourceStatus(id: string, status: DataSource['status'], nodeCount?: number): void {
    if (nodeCount !== undefined) {
      this.db.prepare('UPDATE data_sources SET status = ?, node_count = ?, last_synced = ? WHERE id = ?')
        .run(status, nodeCount, Date.now(), id)
    } else {
      this.db.prepare('UPDATE data_sources SET status = ? WHERE id = ?').run(status, id)
    }
  }

  private rowToSource(row: Record<string, unknown>): DataSource {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      type: row['type'] as DataSource['type'],
      path: row['path'] as string,
      status: row['status'] as DataSource['status'],
      lastSynced: row['last_synced'] as number | undefined,
      nodeCount: row['node_count'] as number,
      color: row['color'] as string,
      icon: row['icon'] as string,
      enabled: Boolean(row['enabled']),
      metadata: JSON.parse(row['metadata'] as string || '{}'),
    }
  }

  // === ENTITIES ===

  upsertEntity(entity: Entity): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO entities
        (id, name, type, mentions, first_seen, last_seen, node_ids, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id, entity.name, entity.type, entity.mentions,
      entity.firstSeen, entity.lastSeen, JSON.stringify(entity.nodeIds),
      entity.summary || null
    )
  }

  getEntities(limit = 100): Entity[] {
    const rows = this.db.prepare(
      'SELECT * FROM entities ORDER BY mentions DESC LIMIT ?'
    ).all(limit) as Record<string, unknown>[]
    return rows.map(r => this.rowToEntity(r))
  }

  private rowToEntity(row: Record<string, unknown>): Entity {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      type: row['type'] as Entity['type'],
      mentions: row['mentions'] as number,
      firstSeen: row['first_seen'] as number,
      lastSeen: row['last_seen'] as number,
      nodeIds: JSON.parse(row['node_ids'] as string || '[]'),
      summary: row['summary'] as string | undefined,
    }
  }

  // === TIMELINE ===

  upsertTimelineEvent(event: TimelineEvent): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO timeline_events
        (id, node_id, title, description, timestamp, type, source_id, source_name, related_entities, significance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.nodeId, event.title, event.description, event.timestamp,
      event.type, event.sourceId, event.sourceName,
      JSON.stringify(event.relatedEntities), event.significance
    )
  }

  getTimeline(limit = 100, offset = 0): TimelineEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM timeline_events ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Record<string, unknown>[]
    return rows.map(r => this.rowToTimelineEvent(r))
  }

  private rowToTimelineEvent(row: Record<string, unknown>): TimelineEvent {
    return {
      id: row['id'] as string,
      nodeId: row['node_id'] as string,
      title: row['title'] as string,
      description: row['description'] as string,
      timestamp: row['timestamp'] as number,
      type: row['type'] as TimelineEvent['type'],
      sourceId: row['source_id'] as string,
      sourceName: row['source_name'] as string,
      relatedEntities: JSON.parse(row['related_entities'] as string || '[]'),
      significance: row['significance'] as TimelineEvent['significance'],
    }
  }

  // === SETTINGS ===

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    `).run(key, JSON.stringify(value), Date.now())
  }

  getAllSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value)
    }
    return result as unknown as AppSettings
  }

  // === STATS ===

  getStats(): Stats {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_nodes').get() as { c: number }).c
    const sourceCount = (this.db.prepare('SELECT COUNT(*) as c FROM data_sources').get() as { c: number }).c
    const entityCount = (this.db.prepare('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_edges').get() as { c: number }).c

    return {
      totalNodes: nodeCount,
      totalSources: sourceCount,
      totalEntities: entityCount,
      totalEdges: edgeCount,
      lastUpdated: Date.now(),
      storageSize: 0,
      ollamaConnected: false,
    }
  }

  close(): void {
    this.db.close()
  }
}
