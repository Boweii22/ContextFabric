import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // Memory
  memory: {
    search: (query: string, limit?: number) =>
      ipcRenderer.invoke('memory:search', query, limit),
    query: (query: string) =>
      ipcRenderer.invoke('memory:query', query),
    getNode: (id: string) =>
      ipcRenderer.invoke('memory:get-node', id),
    getGraph: () =>
      ipcRenderer.invoke('memory:get-graph'),
    getTimeline: (limit?: number) =>
      ipcRenderer.invoke('memory:get-timeline', limit),
    getStats: () =>
      ipcRenderer.invoke('memory:get-stats'),
    getHistory: (limit?: number) =>
      ipcRenderer.invoke('memory:get-history', limit),
  },

  // Sources
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    add: (source: unknown) => ipcRenderer.invoke('sources:add', source),
    remove: (id: string) => ipcRenderer.invoke('sources:remove', id),
    sync: (id: string) => ipcRenderer.invoke('sources:sync', id),
    toggle: (id: string, enabled: boolean) => ipcRenderer.invoke('sources:toggle', id, enabled),
    summary: (sourceId: string) => ipcRenderer.invoke('sources:summary', sourceId),
  },

  // Entities
  entities: {
    list: (limit?: number) => ipcRenderer.invoke('entities:list', limit),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  },

  // Ollama
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    models: () => ipcRenderer.invoke('ollama:models'),
  },

  // Context export
  context: {
    export: (query: string, maxChunks?: number) =>
      ipcRenderer.invoke('context:export', query, maxChunks),
  },

  // Token management
  tokens: {
    list: () => ipcRenderer.invoke('tokens:list'),
    revoke: (token: string) => ipcRenderer.invoke('tokens:revoke', token),
    revokeAll: () => ipcRenderer.invoke('tokens:revoke-all'),
    auditLog: (limit?: number) => ipcRenderer.invoke('tokens:audit-log', limit),
  },

  permissions: {
    requests: (limit?: number) => ipcRenderer.invoke('permissions:requests', limit),
    resolve: (id: string, decision: 'one_hour' | 'session' | 'always' | 'deny') =>
      ipcRenderer.invoke('permissions:resolve', id, decision),
  },

  // Events
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_, ...args) => listener(...args))
    return () => ipcRenderer.removeListener(channel, listener)
  },

  off: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
