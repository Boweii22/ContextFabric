import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Lock, Eye, EyeOff, Code2, Globe, Info,
  Key, Trash2, Clock, RefreshCw, AlertTriangle, CheckCircle2
} from 'lucide-react'
import { useAppStore } from '../../store'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import type { ContextPermission, ContextToken } from '../../../../shared/types'

export default function PermissionsPage(): React.ReactElement {
  const { sources, settings, setSettings } = useAppStore()
  const [tokens, setTokens] = useState<ContextToken[]>([])
  const [revoking, setRevoking] = useState<string | null>(null)
  const [encryptionSaving, setEncryptionSaving] = useState(false)

  useEffect(() => { loadTokens() }, [])

  async function loadTokens() {
    try {
      const list = await api.tokens.list() as ContextToken[]
      setTokens(list)
    } catch { setTokens([]) }
  }

  async function updatePermission(sourceId: string, updates: Partial<ContextPermission>) {
    if (!settings) return
    const current = settings.contextPermissions[sourceId] || {
      sourceId, allowGlobal: true, allowVSCode: true, allowExternal: false, scopes: []
    }
    const updated = { ...current, ...updates }
    const newPerms = { ...settings.contextPermissions, [sourceId]: updated }
    await api.settings.set('contextPermissions', newPerms)
    setSettings({ ...settings, contextPermissions: newPerms })
  }

  async function updateAppPermission(appId: string, allowed: boolean) {
    if (!settings) return
    const current = (settings.allowedApps as Record<string, boolean>) || {}
    const updated = { ...current, [appId]: allowed }
    await api.settings.set('allowedApps', updated)
    setSettings({ ...settings, allowedApps: updated })
  }

  async function toggleEncryption(enabled: boolean) {
    if (!settings) return
    setEncryptionSaving(true)
    try {
      await api.settings.set('encryption', enabled)
      setSettings({ ...settings, encryption: enabled })
    } finally {
      setEncryptionSaving(false)
    }
  }

  async function revokeToken(token: string) {
    setRevoking(token)
    try {
      await api.tokens.revoke(token)
      await loadTokens()
    } finally { setRevoking(null) }
  }

  async function revokeAllTokens() {
    setRevoking('all')
    try {
      await api.tokens.revokeAll()
      setTokens([])
    } finally { setRevoking(null) }
  }

  const allowedApps = (settings?.allowedApps as Record<string, boolean>) || {}

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Context Permissions</h1>
          <p className="text-sm text-slate-500 mt-1">Control which tools can access your memory and how</p>
        </div>

        {/* Info banner */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/15 mb-6"
        >
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-400 leading-relaxed">
            <strong className="text-indigo-400">Local-only:</strong> ContextFabric runs on port 47821 (127.0.0.1 only).
            External tools identify themselves via the <code className="text-indigo-300">X-ContextFabric-App</code> header.
            Nothing leaves your machine.
          </p>
        </motion.div>

        <div className="space-y-4">

          {/* Per-app global access */}
          <section className="surface-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">App Access</h2>
              <span className="text-2xs text-slate-600 ml-auto">Set per-app via X-ContextFabric-App header</span>
            </div>
            <div className="space-y-2">
              {[
                { id: 'vscode', label: 'VSCode Extension', icon: <Code2 className="w-4 h-4 text-cyan-400" />, desc: 'ContextFabric VSCode plugin' },
                { id: 'claude', label: 'Claude / AI Tools', icon: <Shield className="w-4 h-4 text-violet-400" />, desc: 'Claude, Cursor, Copilot Chat' },
                { id: 'external', label: 'External / Unknown', icon: <Globe className="w-4 h-4 text-slate-400" />, desc: 'Any tool without an app header' },
              ].map(({ id, label, icon, desc }) => (
                <PermissionRow
                  key={id}
                  icon={icon}
                  label={label}
                  desc={desc}
                  enabled={allowedApps[id] ?? (id !== 'external')}
                  onChange={v => updateAppPermission(id, v)}
                />
              ))}
            </div>
          </section>

          {/* Per-source permissions */}
          <section className="surface-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-white">Source-Level Access</h2>
            </div>
            {sources.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-600">No sources connected yet</div>
            ) : (
              <div className="space-y-3">
                {sources.map((source, i) => {
                  const perm = settings?.contextPermissions?.[source.id] || {
                    sourceId: source.id, allowGlobal: true, allowVSCode: true, allowExternal: false, scopes: [],
                  }
                  return (
                    <motion.div key={source.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-4 rounded-xl bg-cosmos-700/30 border border-white/[0.05]"
                    >
                      <div className="flex items-center gap-2.5 mb-3">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: source.color }} />
                        <span className="text-sm font-medium text-white">{source.name}</span>
                        <span className="text-xs text-slate-600">{source.nodeCount} nodes</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniToggle label="AI Queries" checked={perm.allowGlobal}
                          onChange={v => updatePermission(source.id, { allowGlobal: v })} />
                        <MiniToggle label="VSCode" checked={perm.allowVSCode}
                          onChange={v => updatePermission(source.id, { allowVSCode: v })} />
                        <MiniToggle label="External" checked={perm.allowExternal}
                          onChange={v => updatePermission(source.id, { allowExternal: v })} />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Encryption */}
          <section className="surface-card p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-white">Local Encryption</h2>
                {encryptionSaving && <RefreshCw className="w-3 h-3 text-slate-500 animate-spin" />}
              </div>
              <ToggleSwitch
                enabled={settings?.encryption ?? false}
                onChange={toggleEncryption}
              />
            </div>
            <p className="text-xs text-slate-500 ml-6">
              Encrypts all node content at rest using AES-256-GCM. Key is stored locally.
              {settings?.encryption && (
                <span className="ml-2 text-emerald-400 font-medium">Active — content is encrypted on disk.</span>
              )}
            </p>
            {settings?.encryption && (
              <div className="mt-3 ml-6 flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Encryption key stored in local settings
              </div>
            )}
          </section>

          {/* Active tokens */}
          <section className="surface-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-semibold text-white">Active Context Tokens</h2>
                <span className="text-2xs px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400">
                  {tokens.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadTokens}
                  className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/[0.04] transition-all">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
                {tokens.length > 0 && (
                  <button onClick={revokeAllTokens} disabled={revoking === 'all'}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-all">
                    <Trash2 className="w-3 h-3" /> Revoke all
                  </button>
                )}
              </div>
            </div>

            {tokens.length === 0 ? (
              <div className="py-6 text-center">
                <Key className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-sm text-slate-600">No active tokens</p>
                <p className="text-xs text-slate-700 mt-1">Tokens are created via POST /api/token</p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {tokens.map(t => (
                    <motion.div key={t.token}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                      className="flex items-start gap-3 p-3 rounded-xl bg-cosmos-700/30 border border-white/[0.05]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-xs text-indigo-300 font-mono truncate">
                            {t.token.substring(0, 12)}…
                          </code>
                          {t.query && (
                            <span className="text-2xs text-slate-500 truncate">"{t.query}"</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-1">{t.summary}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Clock className="w-3 h-3 text-slate-600" />
                          <span className={cn('text-2xs', t.expiresAt < Date.now() + 300000 ? 'text-amber-400' : 'text-slate-600')}>
                            Expires {new Date(t.expiresAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => revokeToken(t.token)}
                        disabled={revoking === t.token}
                        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Revoke token"
                      >
                        {revoking === t.token
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  )
}

function PermissionRow({ icon, label, desc, enabled, onChange }: {
  icon: React.ReactNode; label: string; desc: string; enabled: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl hover:bg-white/[0.02] transition-colors">
      <div className="w-8 h-8 rounded-lg bg-cosmos-700/50 flex items-center justify-center shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{label}</div>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
      <ToggleSwitch enabled={enabled} onChange={onChange} />
    </div>
  )
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!enabled)}
      className={cn('relative rounded-full transition-colors duration-200 shrink-0', enabled ? 'bg-indigo-600' : 'bg-cosmos-600')}
      style={{ width: 40, height: 22 }}
    >
      <motion.div
        animate={{ x: enabled ? 18 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
      />
    </button>
  )
}

function MiniToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-all',
        checked ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-400' : 'bg-cosmos-700/30 border-white/[0.05] text-slate-500 hover:border-white/[0.1]'
      )}
    >
      <span>{label}</span>
      {checked ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
    </button>
  )
}
