import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import type {
  MemoryNode, MemoryEdge, DataSource, Entity,
  TimelineEvent, AppSettings, Stats, AIQueryResult
} from '../../shared/types'

// ─── CR-SQLite Readiness ─────────────────────────────────────────────────────
//
// This schema is structured for future CR-SQLite / multi-device sync:
//
//  • All primary keys are UUIDs (globally unique, no collisions across devices)
//  • Every mutable table has:
//      - `version`    INTEGER  — logical clock, incremented on each write
//      - `site_id`    TEXT     — which device last wrote this row
//      - `deleted_at` INTEGER  — soft delete timestamp (NULL = alive)
//  • `sync_changes` table logs every INSERT/UPDATE/DELETE for sync transport
//  • `site_id` in settings identifies this device permanently
//
// To enable full sync later:
//   npm install @vlcn.io/crsqlite-allinone
//   Then call: SELECT crsql_as_crr('table_name') for each table
//   The sync_changes table maps directly to crsql_changes format
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 2

export class DatabaseService {
  private db!: Database.Database
  private dbPath: string
  private siteId!: string

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
    this.siteId = this.getOrCreateSiteId()
    this.resetStuckSources()
  }

  // Any source left as 'indexing' from a previous crashed/killed sync
  // is reset to 'idle' so the UI doesn't show phantom indexing on restart
  private resetStuckSources(): void {
    this.db.prepare(
      "UPDATE data_sources SET status = 'idle' WHERE status = 'indexing'"
    ).run()
  }

  getSiteId(): string { return this.siteId }

  // ─── Migrations ────────────────────────────────────────────────────────────

  private runMigrations(): void {
    // Base schema (v1)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_nodes (
        id          TEXT    PRIMARY KEY,
        title       TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        source_id   TEXT    NOT NULL,
        source_name TEXT    NOT NULL,
        source_type TEXT    NOT NULL,
        timestamp   INTEGER NOT NULL,
        tags        TEXT    NOT NULL DEFAULT '[]',
        entities    TEXT    NOT NULL DEFAULT '[]',
        summary     TEXT,
        metadata    TEXT    NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        node_id    TEXT PRIMARY KEY,
        embedding  BLOB    NOT NULL,
        dimensions INTEGER NOT NULL,
        model      TEXT    NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_edges (
        id        TEXT    PRIMARY KEY,
        source_id TEXT    NOT NULL,
        target_id TEXT    NOT NULL,
        type      TEXT    NOT NULL,
        weight    REAL    NOT NULL DEFAULT 1.0,
        label     TEXT,
        metadata  TEXT    NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (source_id) REFERENCES memory_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS data_sources (
        id          TEXT    PRIMARY KEY,
        name        TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        path        TEXT    NOT NULL,
        status      TEXT    NOT NULL DEFAULT 'idle',
        last_synced INTEGER,
        node_count  INTEGER NOT NULL DEFAULT 0,
        color       TEXT    NOT NULL DEFAULT '#6366F1',
        icon        TEXT    NOT NULL DEFAULT 'database',
        enabled     INTEGER NOT NULL DEFAULT 1,
        metadata    TEXT    NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS entities (
        id         TEXT    PRIMARY KEY,
        name       TEXT    NOT NULL,
        type       TEXT    NOT NULL,
        mentions   INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        node_ids   TEXT    NOT NULL DEFAULT '[]',
        summary    TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS timeline_events (
        id               TEXT    PRIMARY KEY,
        node_id          TEXT    NOT NULL,
        title            TEXT    NOT NULL,
        description      TEXT    NOT NULL,
        timestamp        INTEGER NOT NULL,
        type             TEXT    NOT NULL,
        source_id        TEXT    NOT NULL,
        source_name      TEXT    NOT NULL,
        related_entities TEXT    NOT NULL DEFAULT '[]',
        significance     TEXT    NOT NULL DEFAULT 'medium',
        created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (node_id) REFERENCES memory_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT    NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_source    ON memory_nodes(source_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_type      ON memory_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_timestamp ON memory_nodes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_edges_source    ON memory_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target    ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_entities_name   ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_timeline_ts     ON timeline_events(timestamp);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        id UNINDEXED,
        title,
        content,
        tags,
        entities,
        tokenize='porter unicode61'
      );
    `)

    const currentVersion = this.getSchemaVersion()

    // v2 migration — CR-SQLite ready columns + query_history + sync_changes
    if (currentVersion < 2) {
      this.db.exec(`
        -- CR-SQLite: site identifier (which device owns each row)
        ALTER TABLE memory_nodes     ADD COLUMN site_id    TEXT    DEFAULT '';
        ALTER TABLE memory_nodes     ADD COLUMN version    INTEGER DEFAULT 1;
        ALTER TABLE memory_nodes     ADD COLUMN deleted_at INTEGER DEFAULT NULL;

        ALTER TABLE memory_edges     ADD COLUMN site_id    TEXT    DEFAULT '';
        ALTER TABLE memory_edges     ADD COLUMN version    INTEGER DEFAULT 1;
        ALTER TABLE memory_edges     ADD COLUMN deleted_at INTEGER DEFAULT NULL;

        ALTER TABLE data_sources     ADD COLUMN site_id    TEXT    DEFAULT '';
        ALTER TABLE data_sources     ADD COLUMN version    INTEGER DEFAULT 1;
        ALTER TABLE data_sources     ADD COLUMN deleted_at INTEGER DEFAULT NULL;

        ALTER TABLE entities         ADD COLUMN site_id    TEXT    DEFAULT '';
        ALTER TABLE entities         ADD COLUMN version    INTEGER DEFAULT 1;

        ALTER TABLE timeline_events  ADD COLUMN site_id    TEXT    DEFAULT '';
        ALTER TABLE timeline_events  ADD COLUMN version    INTEGER DEFAULT 1;

        -- Change log: maps to crsql_changes format for future sync transport
        -- table_name | pk | cid (column name) | val | col_version | db_version | site_id | cl
        CREATE TABLE IF NOT EXISTS sync_changes (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name  TEXT    NOT NULL,
          row_pk      TEXT    NOT NULL,
          operation   TEXT    NOT NULL CHECK(operation IN ('insert','update','delete')),
          col_name    TEXT,
          col_value   TEXT,
          row_version INTEGER NOT NULL DEFAULT 1,
          site_id     TEXT    NOT NULL,
          created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_changes_table   ON sync_changes(table_name);
        CREATE INDEX IF NOT EXISTS idx_sync_changes_site    ON sync_changes(site_id);
        CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON sync_changes(created_at);

        -- Persistent query history
        CREATE TABLE IF NOT EXISTS query_history (
          id              TEXT    PRIMARY KEY,
          query           TEXT    NOT NULL,
          answer          TEXT    NOT NULL,
          sources_json    TEXT    NOT NULL DEFAULT '[]',
          entities_json   TEXT    NOT NULL DEFAULT '[]',
          confidence      REAL    NOT NULL DEFAULT 0,
          processing_time INTEGER NOT NULL DEFAULT 0,
          created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_qhist_created ON query_history(created_at DESC);
      `)

      this.setSchemaVersion(2)
    }

    this.initializeDefaultSettings()
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare(
        'SELECT MAX(version) as v FROM schema_version'
      ).get() as { v: number | null }
      return row?.v ?? 0
    } catch {
      return 0
    }
  }

  private setSchemaVersion(version: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)'
    ).run(version, Date.now())
  }

  private getOrCreateSiteId(): string {
    const existing = this.getSetting<string>('site_id')
    if (existing) return existing
    const id = uuidv4()
    this.setSetting('site_id', id)
    return id
  }

  // ─── Sync change log ────────────────────────────────────────────────────────
  // Called internally on every write. When CR-SQLite is enabled, this table
  // syncs automatically — until then it gives us a manual audit trail.

  private logChange(
    table: string,
    rowPk: string,
    operation: 'insert' | 'update' | 'delete',
    version: number
  ): void {
    this.db.prepare(`
      INSERT INTO sync_changes (table_name, row_pk, operation, row_version, site_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(table, rowPk, operation, version, this.siteId)
  }

  getSyncChanges(sinceVersion?: number): Array<Record<string, unknown>> {
    if (sinceVersion !== undefined) {
      return this.db.prepare(
        'SELECT * FROM sync_changes WHERE row_version > ? ORDER BY created_at ASC'
      ).all(sinceVersion) as Array<Record<string, unknown>>
    }
    return this.db.prepare(
      'SELECT * FROM sync_changes ORDER BY created_at ASC'
    ).all() as Array<Record<string, unknown>>
  }

  // ─── Default settings ───────────────────────────────────────────────────────

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

    this.db.prepare(
      'UPDATE app_settings SET value = ? WHERE key = ? AND value = ?'
    ).run(JSON.stringify('gemma4:e4b'), 'ollamaModel', JSON.stringify('gemma3:12b'))
  }

  // ─── NODES ─────────────────────────────────────────────────────────────────

  upsertNode(node: MemoryNode): void {
    const existing = this.db.prepare(
      'SELECT version FROM memory_nodes WHERE id = ?'
    ).get(node.id) as { version: number } | undefined
    const version = (existing?.version ?? 0) + 1

    this.db.prepare(`
      INSERT OR REPLACE INTO memory_nodes
        (id, title, content, type, source_id, source_name, source_type,
         timestamp, tags, entities, summary, metadata, site_id, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id, node.title, node.content, node.type,
      node.sourceId, node.sourceName, node.sourceType,
      node.timestamp, JSON.stringify(node.tags), JSON.stringify(node.entities),
      node.summary || null, JSON.stringify(node.metadata),
      this.siteId, version
    )

    this.db.prepare(`
      INSERT OR REPLACE INTO nodes_fts (id, title, content, tags, entities)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      node.id, node.title, node.content.substring(0, 10000),
      node.tags.join(' '), node.entities.join(' ')
    )

    this.logChange('memory_nodes', node.id, existing ? 'update' : 'insert', version)
  }

  batchUpsertNodes(nodes: MemoryNode[]): void {
    const tx = this.db.transaction((nodes: MemoryNode[]) => {
      for (const node of nodes) this.upsertNode(node)
    })
    tx(nodes)
  }

  getNode(id: string): MemoryNode | null {
    const row = this.db.prepare(
      'SELECT * FROM memory_nodes WHERE id = ? AND deleted_at IS NULL'
    ).get(id) as Record<string, unknown> | undefined
    return row ? this.rowToNode(row) : null
  }

  getNodes(limit = 100, offset = 0): MemoryNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory_nodes WHERE deleted_at IS NULL ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as Record<string, unknown>[]
    return rows.map(r => this.rowToNode(r))
  }

  getNodesBySource(sourceId: string): MemoryNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory_nodes WHERE source_id = ? AND deleted_at IS NULL ORDER BY timestamp DESC'
    ).all(sourceId) as Record<string, unknown>[]
    return rows.map(r => this.rowToNode(r))
  }

  // Soft delete — sets deleted_at instead of removing the row
  deleteNodesBySource(sourceId: string): void {
    const now = Date.now()
    const rows = this.db.prepare(
      'SELECT id FROM memory_nodes WHERE source_id = ?'
    ).all(sourceId) as Array<{ id: string }>
    const version = Date.now()
    this.db.prepare(
      'UPDATE memory_nodes SET deleted_at = ?, version = ?, site_id = ? WHERE source_id = ?'
    ).run(now, version, this.siteId, sourceId)
    for (const { id } of rows) {
      this.logChange('memory_nodes', id, 'delete', version)
    }
  }

  keywordSearch(query: string, limit = 20): Array<{ node: MemoryNode; score: number }> {
    const sanitized = query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
    if (!sanitized) return []
    const rows = this.db.prepare(`
      SELECT n.*, bm25(nodes_fts) as score
      FROM nodes_fts f
      JOIN memory_nodes n ON n.id = f.id
      WHERE nodes_fts MATCH ? AND n.deleted_at IS NULL
      ORDER BY score
      LIMIT ?
    `).all(sanitized + '*', limit) as Array<Record<string, unknown>>

    return rows.map(r => ({
      node: this.rowToNode(r),
      score: Math.abs(r['score'] as number),
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

  // ─── EMBEDDINGS ─────────────────────────────────────────────────────────────

  saveEmbedding(nodeId: string, embedding: number[], model: string): void {
    const buffer = Buffer.from(new Float32Array(embedding).buffer)
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_embeddings (node_id, embedding, dimensions, model)
      VALUES (?, ?, ?, ?)
    `).run(nodeId, buffer, embedding.length, model)
  }

  batchSaveEmbeddings(items: Array<{ nodeId: string; embedding: number[] }>, model: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory_embeddings (node_id, embedding, dimensions, model)
      VALUES (?, ?, ?, ?)
    `)
    const tx = this.db.transaction(() => {
      for (const { nodeId, embedding } of items) {
        const buffer = Buffer.from(new Float32Array(embedding).buffer)
        stmt.run(nodeId, buffer, embedding.length, model)
      }
    })
    tx()
  }

  getEmbedding(nodeId: string): number[] | null {
    const row = this.db.prepare(
      'SELECT embedding FROM memory_embeddings WHERE node_id = ?'
    ).get(nodeId) as { embedding: Buffer } | undefined
    if (!row) return null
    return Array.from(new Float32Array(row.embedding.buffer))
  }

  getAllEmbeddings(): Array<{ nodeId: string; embedding: number[] }> {
    const rows = this.db.prepare(`
      SELECT e.node_id, e.embedding
      FROM memory_embeddings e
      JOIN memory_nodes n ON n.id = e.node_id
      WHERE n.deleted_at IS NULL
    `).all() as Array<{ node_id: string; embedding: Buffer }>
    return rows.map(r => ({
      nodeId: r.node_id,
      embedding: Array.from(new Float32Array(r.embedding.buffer)),
    }))
  }

  // ─── EDGES ─────────────────────────────────────────────────────────────────

  upsertEdge(edge: MemoryEdge): void {
    const existing = this.db.prepare(
      'SELECT version FROM memory_edges WHERE id = ?'
    ).get(edge.id) as { version: number } | undefined
    const version = (existing?.version ?? 0) + 1

    this.db.prepare(`
      INSERT OR REPLACE INTO memory_edges
        (id, source_id, target_id, type, weight, label, metadata, site_id, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(edge.id, edge.source, edge.target, edge.type, edge.weight,
      edge.label || null, JSON.stringify(edge.metadata), this.siteId, version)

    this.logChange('memory_edges', edge.id, existing ? 'update' : 'insert', version)
  }

  getEdgesForNode(nodeId: string): MemoryEdge[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_edges
      WHERE (source_id = ? OR target_id = ?) AND deleted_at IS NULL
    `).all(nodeId, nodeId) as Record<string, unknown>[]
    return rows.map(r => this.rowToEdge(r))
  }

  getAllEdges(): MemoryEdge[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory_edges WHERE deleted_at IS NULL'
    ).all() as Record<string, unknown>[]
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

  // ─── SOURCES ───────────────────────────────────────────────────────────────

  upsertSource(source: DataSource): void {
    const existing = this.db.prepare(
      'SELECT version FROM data_sources WHERE id = ?'
    ).get(source.id) as { version: number } | undefined
    const version = (existing?.version ?? 0) + 1

    this.db.prepare(`
      INSERT OR REPLACE INTO data_sources
        (id, name, type, path, status, last_synced, node_count,
         color, icon, enabled, metadata, site_id, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id, source.name, source.type, source.path, source.status,
      source.lastSynced || null, source.nodeCount, source.color, source.icon,
      source.enabled ? 1 : 0, JSON.stringify(source.metadata),
      this.siteId, version
    )

    this.logChange('data_sources', source.id, existing ? 'update' : 'insert', version)
  }

  getSources(): DataSource[] {
    const rows = this.db.prepare(
      'SELECT * FROM data_sources WHERE deleted_at IS NULL ORDER BY created_at ASC'
    ).all() as Record<string, unknown>[]
    return rows.map(r => this.rowToSource(r))
  }

  getSource(id: string): DataSource | null {
    const row = this.db.prepare(
      'SELECT * FROM data_sources WHERE id = ? AND deleted_at IS NULL'
    ).get(id) as Record<string, unknown> | undefined
    return row ? this.rowToSource(row) : null
  }

  deleteSource(id: string): void {
    const now = Date.now()
    this.db.transaction(() => {
      this.deleteNodesBySource(id)
      this.db.prepare(
        'UPDATE data_sources SET deleted_at = ?, version = ?, site_id = ? WHERE id = ?'
      ).run(now, now, this.siteId, id)
      this.logChange('data_sources', id, 'delete', now)
    })()
  }

  updateSourceStatus(id: string, status: DataSource['status'], nodeCount?: number): void {
    if (nodeCount !== undefined) {
      this.db.prepare(
        'UPDATE data_sources SET status = ?, node_count = ?, last_synced = ?, version = version + 1 WHERE id = ?'
      ).run(status, nodeCount, Date.now(), id)
    } else {
      this.db.prepare(
        'UPDATE data_sources SET status = ?, version = version + 1 WHERE id = ?'
      ).run(status, id)
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

  // ─── ENTITIES ──────────────────────────────────────────────────────────────

  upsertEntity(entity: Entity): void {
    const existing = this.db.prepare(
      'SELECT version FROM entities WHERE id = ?'
    ).get(entity.id) as { version: number } | undefined
    const version = (existing?.version ?? 0) + 1

    this.db.prepare(`
      INSERT OR REPLACE INTO entities
        (id, name, type, mentions, first_seen, last_seen, node_ids, summary, site_id, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id, entity.name, entity.type, entity.mentions,
      entity.firstSeen, entity.lastSeen, JSON.stringify(entity.nodeIds),
      entity.summary || null, this.siteId, version
    )
  }

  batchUpsertEntities(entities: Entity[]): void {
    const tx = this.db.transaction(() => {
      for (const entity of entities) this.upsertEntity(entity)
    })
    tx()
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

  // ─── TIMELINE ──────────────────────────────────────────────────────────────

  upsertTimelineEvent(event: TimelineEvent): void {
    const existing = this.db.prepare(
      'SELECT version FROM timeline_events WHERE id = ?'
    ).get(event.id) as { version: number } | undefined
    const version = (existing?.version ?? 0) + 1

    this.db.prepare(`
      INSERT OR REPLACE INTO timeline_events
        (id, node_id, title, description, timestamp, type,
         source_id, source_name, related_entities, significance, site_id, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.nodeId, event.title, event.description, event.timestamp,
      event.type, event.sourceId, event.sourceName,
      JSON.stringify(event.relatedEntities), event.significance,
      this.siteId, version
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

  // ─── QUERY HISTORY ─────────────────────────────────────────────────────────

  saveQueryHistory(result: AIQueryResult): void {
    this.db.prepare(`
      INSERT INTO query_history
        (id, query, answer, sources_json, entities_json, confidence, processing_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      result.query,
      result.answer,
      JSON.stringify(result.sources.map(s => ({
        title: s.node.title,
        sourceName: s.node.sourceName,
        score: s.score,
        timestamp: s.node.timestamp,
      }))),
      JSON.stringify(result.entities),
      result.confidence,
      result.processingTime
    )
  }

  getQueryHistory(limit = 30): AIQueryResult[] {
    const rows = this.db.prepare(
      'SELECT * FROM query_history ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as Array<Record<string, unknown>>

    return rows.map(r => ({
      query: r['query'] as string,
      answer: r['answer'] as string,
      reasoning: '',
      sources: JSON.parse(r['sources_json'] as string || '[]'),
      entities: JSON.parse(r['entities_json'] as string || '[]'),
      confidence: r['confidence'] as number,
      processingTime: r['processing_time'] as number,
    }))
  }

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    `).run(key, JSON.stringify(value), Date.now())
  }

  getAllSettings(): AppSettings {
    const rows = this.db.prepare(
      'SELECT key, value FROM app_settings'
    ).all() as Array<{ key: string; value: string }>
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value)
    }
    return result as unknown as AppSettings
  }

  // ─── STATS ─────────────────────────────────────────────────────────────────

  getStats(): Stats {
    const q = (sql: string) =>
      (this.db.prepare(sql).get() as { c: number }).c

    return {
      totalNodes: q('SELECT COUNT(*) as c FROM memory_nodes WHERE deleted_at IS NULL'),
      totalSources: q('SELECT COUNT(*) as c FROM data_sources WHERE deleted_at IS NULL'),
      totalEntities: q('SELECT COUNT(*) as c FROM entities'),
      totalEdges: q('SELECT COUNT(*) as c FROM memory_edges WHERE deleted_at IS NULL'),
      lastUpdated: Date.now(),
      storageSize: 0,
      ollamaConnected: false,
    }
  }

  close(): void {
    this.db.close()
  }
}
