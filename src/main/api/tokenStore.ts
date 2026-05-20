import type { ContextToken } from '../../shared/types'

interface TokenEntry {
  context: string
  summary: string
  expiresAt: number
  createdAt: number
  query?: string
}

// Singleton token store shared between HTTP API and IPC handlers
const store = new Map<string, TokenEntry>()

export function setToken(token: string, entry: TokenEntry): void {
  store.set(token, entry)
  cleanup()
}

export function getToken(token: string): TokenEntry | undefined {
  const entry = store.get(token)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) { store.delete(token); return undefined }
  return entry
}

export function revokeToken(token: string): boolean {
  return store.delete(token)
}

export function listTokens(): ContextToken[] {
  cleanup()
  return [...store.entries()].map(([token, e]) => ({
    token,
    summary: e.summary,
    expiresAt: e.expiresAt,
    createdAt: e.createdAt,
    query: e.query,
  }))
}

export function revokeAll(): void {
  store.clear()
}

function cleanup(): void {
  const now = Date.now()
  for (const [t, v] of store) {
    if (v.expiresAt < now) store.delete(t)
  }
}
