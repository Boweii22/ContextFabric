export interface MemoryNode {
  id: string
  title: string
  content: string
  type: 'conversation' | 'document' | 'code' | 'note' | 'decision' | 'entity' | 'project'
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
}

export interface ContextToken {
  token: string
  summary: string
  expiresAt: number
  createdAt: number
  query?: string
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
  | 'ollama:status'
  | 'ollama:models'
  | 'processing:status'
  | 'context:export'
