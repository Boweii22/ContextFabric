// Type-safe wrapper around the Electron preload API

declare global {
  interface Window {
    api: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
      }
      memory: {
        search: (query: string, limit?: number) => Promise<unknown>
        query: (query: string) => Promise<unknown>
        getNode: (id: string) => Promise<unknown>
        getGraph: () => Promise<unknown>
        getTimeline: (limit?: number) => Promise<unknown>
        getStats: () => Promise<unknown>
      }
      sources: {
        list: () => Promise<unknown>
        add: (source: unknown) => Promise<unknown>
        remove: (id: string) => Promise<unknown>
        sync: (id: string) => Promise<unknown>
        toggle: (id: string, enabled: boolean) => Promise<unknown>
      }
      entities: {
        list: (limit?: number) => Promise<unknown>
      }
      settings: {
        get: () => Promise<unknown>
        set: (key: string, value: unknown) => Promise<unknown>
      }
      ollama: {
        status: () => Promise<unknown>
        models: () => Promise<unknown>
      }
      context: {
        export: (query: string, maxChunks?: number) => Promise<unknown>
      }
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void
      off: (channel: string, listener: (...args: unknown[]) => void) => void
    }
  }
}

export const api = window.api

export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.api !== 'undefined'
}
