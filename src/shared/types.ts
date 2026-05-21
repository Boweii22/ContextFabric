export interface MemoryNode {
  id: string
  title: string
  content: string
  type: 'conversation' | 'document' | 'code' | 'note' | 'decision' | 'entity' | 'project' | 'style' | 'preference' | 'person'
  sourceId: string
  sourceName: string
  sourceType: string
  timestamp: number
  tags: string[]
  entities: string[]
  embedding?: number[]
  summary?: string
  metadata: Record<string, unknown>
}

export interface MemoryEdge {
  id: string
  source: string
  target: string
  type: 'related' | 'references' | 'contradicts' | 'extends' | 'belongs_to' | 'decided_by' | 'caused_by' | 'replaced' | 'depends_on'
  weight: number
  label?: string
  metadata: Record<string, unknown>
}

export interface DataSource {
  id: string
  name: string
  type: 'claude_export' | 'chatgpt_export' | 'local_folder' | 'github_repo' | 'markdown' | 'pdf' | 'notion_export' | 'vscode_workspace'
  path: string
  status: 'idle' | 'indexing' | 'ready' | 'error'
  lastSynced?: number
  nodeCount: number
  color: string
  icon: string
  enabled: boolean
  metadata: Record<string, unknown>
}

export interface SearchResult {
  node: MemoryNode
  score: number
  highlights: string[]
  sourceContext: string
}

export interface AIQueryResult {
  query: string
  answer: string
  reasoning: string
  sources: SearchResult[]
  entities: string[]
  timeline?: TimelineEvent[]
  confidence: number
  processingTime: number
  citations?: Array<{ index: number; title: string; sourceName: string }>
  conflicts?: string[]
  decisionChain?: string[]
}

export interface TimelineEvent {
  id: string
  nodeId: string
  title: string
  description: string
  timestamp: number
  type: 'decision' | 'milestone' | 'pivot' | 'discovery' | 'rejection' | 'adoption'
  sourceId: string
  sourceName: string
  relatedEntities: string[]
  significance: 'low' | 'medium' | 'high'
}

export interface Entity {
  id: string
  name: string
  type: 'technology' | 'person' | 'project' | 'concept' | 'tool' | 'organization'
  mentions: number
  firstSeen: number
  lastSeen: number
  nodeIds: string[]
  summary?: string
}

export interface ProcessingStatus {
  sourceId: string
  phase: 'parsing' | 'chunking' | 'embedding' | 'graphing' | 'indexing'
  progress: number
  total: number
  message: string
  startTime: number
}

export interface AppSettings {
  ollamaUrl: string
  ollamaModel: string
  embeddingModel: string
  maxContextLength: number
  autoSync: boolean
  syncInterval: number
  theme: 'dark' | 'light' | 'system'
  privacyMode: boolean
  telemetry: boolean
  contextPermissions: Record<string, ContextPermission>
  encryption: boolean
  encryptionKey?: string
  allowedApps: Record<string, boolean>  // app identifier → globally allowed
  geminiApiKey?: string
  geminiModel?: string
  syncKey?: string
  syncPeerUrl?: string
  syncPeerKey?: string
  syncLanEnabled?: boolean
}

export interface CRSQLiteStatus {
  enabled: boolean
  siteId: string
  dbVersion: number
  syncKey: string
  lanPort: number
  lanUrls: string[]
  lastError?: string
  peers: SyncPeer[]
}

export interface SyncPeer {
  peerSiteId: string
  peerUrl?: string
  lastSeen: number
  lastReceivedDbVersion: number
  lastSentDbVersion: number
}

export interface CRSQLiteChange {
  table: string
  pk: string
  cid: string
  val: unknown
  valEncoding: 'json' | 'base64'
  colVersion: number
  dbVersion: number
  siteId: string
}

export interface SyncRunResult {
  ok: boolean
  peerUrl: string
  peerSiteId?: string
  pulled: number
  pushed: number
  localDbVersion: number
  remoteDbVersion?: number
  message: string
}

export interface AppAccessGrant {
  id: string
  appId: string
  grantType: 'one_hour' | 'session' | 'always'
  scopes: string[]
  sourceIds: string[]
  expiresAt?: number
  createdAt: number
  revokedAt?: number
}

export interface ContextPermissionRequest {
  id: string
  appId: string
  requestedScopes: string[]
  requestedSourceIds: string[]
  reason?: string
  status: 'pending' | 'granted' | 'denied'
  grantType?: 'one_hour' | 'session' | 'always'
  expiresAt?: number
  createdAt: number
  resolvedAt?: number
}

export interface ContextToken {
  token: string
  summary: string
  expiresAt: number
  createdAt: number
  query?: string
  appId?: string
  scope?: string
  revokedAt?: number
  sourceIds?: string[]
}

export interface ContextAccessLog {
  id: string
  appId: string
  action: 'permission_requested' | 'permission_granted' | 'token_issued' | 'token_retrieved' | 'context_query' | 'context_inject' | 'memory_search' | 'denied' | 'token_revoked'
  tokenHash?: string
  sourceIds: string[]
  query?: string
  scope?: string
  success: boolean
  details?: string
  createdAt: number
}

export interface ContextPermission {
  sourceId: string
  allowGlobal: boolean
  allowVSCode: boolean
  allowExternal: boolean
  scopes: string[]
}

export interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
}

export interface GraphNode {
  id: string
  label: string
  type: string
  x?: number
  y?: number
  size: number
  color: string
  data: MemoryNode
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  weight: number
  label?: string
}

export interface GraphCluster {
  id: string
  label: string
  nodeIds: string[]
  color: string
  centroid: { x: number; y: number }
}

export interface Stats {
  totalNodes: number
  totalSources: number
  totalEntities: number
  totalEdges: number
  lastUpdated: number
  storageSize: number
  ollamaConnected: boolean
}

export type IpcChannel =
  | 'memory:search'
  | 'memory:query'
  | 'memory:get-node'
  | 'memory:get-graph'
  | 'memory:get-timeline'
  | 'memory:get-stats'
  | 'sources:list'
  | 'sources:add'
  | 'sources:remove'
  | 'sources:sync'
  | 'sources:toggle'
  | 'entities:list'
  | 'entities:get'
  | 'settings:get'
  | 'settings:set'
  | 'sync:status'
  | 'sync:run'
  | 'ollama:status'
  | 'ollama:models'
  | 'processing:status'
  | 'context:export'
