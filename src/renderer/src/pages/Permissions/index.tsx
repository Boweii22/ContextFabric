import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, Lock, Eye, EyeOff, Code2, Globe, ToggleLeft, ToggleRight, Info } from 'lucide-react'
import { useAppStore } from '../../store'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import type { ContextPermission } from '../../../../shared/types'

export default function PermissionsPage(): React.ReactElement {
  const { sources, settings, setSettings } = useAppStore()

  async function updatePermission(sourceId: string, updates: Partial<ContextPermission>) {
    if (!settings) return
    const current = settings.contextPermissions[sourceId] || {
      sourceId, allowGlobal: true, allowVSCode: true, allowExternal: false, scopes: []
    }
    const updated = { ...current, ...updates }
    const newSettings = {
      ...settings,
      contextPermissions: { ...settings.contextPermissions, [sourceId]: updated }
    }
    await api.settings.set('contextPermissions', newSettings.contextPermissions)
    setSettings(newSettings)
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Context Permissions</h1>
          <p className="text-sm text-slate-500 mt-1">Control which tools can access your memory context</p>
        </div>

        {/* Info banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/15 mb-6"
        >
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-400 leading-relaxed">
            <strong className="text-indigo-400">How this works:</strong> ContextFabric exposes a local API on port 47821 that other tools can query.
            These permissions control which sources each tool can access.
            Nothing leaves your machine — all queries are local-to-local.
          </div>
        </motion.div>

        {/* Global permissions */}
        <div className="surface-card p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Global Permissions</h2>
          </div>

          <div className="space-y-3">
            <PermissionRow
              icon={<Code2 className="w-4 h-4 text-cyan-400" />}
              label="VSCode Extension"
              desc="Allow ContextFabric VSCode extension to query your context"
              enabled={true}
              onChange={() => {}}
              badge="Recommended"
            />
            <PermissionRow
              icon={<Globe className="w-4 h-4 text-slate-400" />}
              label="Local HTTP API"
              desc="Allow any local tool to query via localhost:47821"
              enabled={false}
              onChange={() => {}}
            />
          </div>
        </div>

        {/* Per-source permissions */}
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-white">Source-Level Access</h2>
          </div>

          {sources.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-600">
              No sources connected yet
            </div>
          ) : (
            <div className="space-y-3">
              {sources.map((source, i) => {
                const perm = settings?.contextPermissions?.[source.id] || {
                  sourceId: source.id,
                  allowGlobal: true,
                  allowVSCode: true,
                  allowExternal: false,
                  scopes: [],
                }

                return (
                  <motion.div
                    key={source.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="p-4 rounded-xl bg-cosmos-700/30 border border-white/[0.05]"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: source.color }}
                        />
                        <span className="text-sm font-medium text-white">{source.name}</span>
                        <span className="text-xs text-slate-600">{source.nodeCount} nodes</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <MiniToggle
                        label="AI Queries"
                        checked={perm.allowGlobal}
                        onChange={v => updatePermission(source.id, { allowGlobal: v })}
                      />
                      <MiniToggle
                        label="VSCode"
                        checked={perm.allowVSCode}
                        onChange={v => updatePermission(source.id, { allowVSCode: v })}
                      />
                      <MiniToggle
                        label="External"
                        checked={perm.allowExternal}
                        onChange={v => updatePermission(source.id, { allowExternal: v })}
                      />
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PermissionRow({ icon, label, desc, enabled, onChange, badge }: {
  icon: React.ReactNode
  label: string
  desc: string
  enabled: boolean
  onChange: (v: boolean) => void
  badge?: string
}) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl hover:bg-white/[0.02] transition-colors">
      <div className="w-8 h-8 rounded-lg bg-cosmos-700/50 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{label}</span>
          {badge && (
            <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={cn(
          'relative rounded-full transition-colors duration-200 shrink-0',
          enabled ? 'bg-indigo-600' : 'bg-cosmos-600'
        )}
        style={{ width: 40, height: 22 }}
      >
        <motion.div
          animate={{ x: enabled ? 18 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
        />
      </button>
    </div>
  )
}

function MiniToggle({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-all',
        checked
          ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-400'
          : 'bg-cosmos-700/30 border-white/[0.05] text-slate-500 hover:border-white/[0.1]'
      )}
    >
      <span>{label}</span>
      {checked
        ? <Eye className="w-3 h-3" />
        : <EyeOff className="w-3 h-3" />}
    </button>
  )
}
