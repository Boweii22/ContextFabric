import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Settings, Server, Brain, Database, RefreshCw, Check,
  AlertCircle, Zap, ChevronRight, Loader2, Eye, EyeOff
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { cn } from '../../lib/utils'
import type { AppSettings } from '../../../../shared/types'

export default function SettingsPage(): React.ReactElement {
  const { settings, setSettings, ollamaConnected, setOllamaConnected } = useAppStore()
  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [testingOllama, setTestingOllama] = useState(false)
  const [models, setModels] = useState<Array<{ name: string }>>([])

  useEffect(() => {
    if (settings) setLocalSettings({ ...settings })
    loadModels()
  }, [settings])

  async function loadModels() {
    try {
      const m = await api.ollama.models() as Array<{ name: string }>
      setModels(m)
    } catch {
      setModels([])
    }
  }

  async function saveSetting(key: keyof AppSettings, value: unknown) {
    setSaving(key as string)
    try {
      await api.settings.set(key as string, value)
      const updated = await api.settings.get() as AppSettings
      setSettings(updated)
      setLocalSettings(updated)
    } finally {
      setSaving(null)
    }
  }

  async function testOllama() {
    setTestingOllama(true)
    try {
      const status = await api.ollama.status() as { connected: boolean }
      setOllamaConnected(status.connected)
      if (status.connected) await loadModels()
    } finally {
      setTestingOllama(false)
    }
  }

  if (!localSettings) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
    </div>
  )

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">Configure ContextFabric</p>
        </div>

        <div className="space-y-4">
          {/* Ollama / AI */}
          <SettingsSection title="Local AI" icon={<Brain className="w-4 h-4 text-indigo-400" />}>
            {/* Connection status */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-cosmos-700/40">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center',
                  ollamaConnected ? 'bg-emerald-500/15' : 'bg-red-500/15'
                )}>
                  {ollamaConnected
                    ? <Check className="w-4 h-4 text-emerald-400" />
                    : <AlertCircle className="w-4 h-4 text-red-400" />}
                </div>
                <div>
                  <div className="text-sm font-medium text-white">
                    {ollamaConnected ? 'Ollama Connected' : 'Ollama Disconnected'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {ollamaConnected ? `${models.length} models available` : 'Install Ollama to enable local AI'}
                  </div>
                </div>
              </div>
              <button
                onClick={testOllama}
                disabled={testingOllama}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.1] text-xs text-slate-300 hover:bg-white/[0.04] transition-all"
              >
                {testingOllama ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Test
              </button>
            </div>

            <SettingField label="Ollama URL">
              <input
                type="text"
                value={localSettings.ollamaUrl}
                onChange={e => setLocalSettings({ ...localSettings, ollamaUrl: e.target.value })}
                onBlur={() => saveSetting('ollamaUrl', localSettings.ollamaUrl)}
                className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/40"
              />
            </SettingField>

            <SettingField label="AI Model" hint="Gemma 3 models recommended">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localSettings.ollamaModel}
                  onChange={e => setLocalSettings({ ...localSettings, ollamaModel: e.target.value })}
                  onBlur={() => saveSetting('ollamaModel', localSettings.ollamaModel)}
                  className="flex-1 bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/40"
                />
                {models.length > 0 && (
                  <select
                    value={localSettings.ollamaModel}
                    onChange={e => {
                      setLocalSettings({ ...localSettings, ollamaModel: e.target.value })
                      saveSetting('ollamaModel', e.target.value)
                    }}
                    className="bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/40 cursor-pointer"
                  >
                    {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                )}
              </div>
            </SettingField>

            <SettingField label="Embedding Model" hint="Used for semantic search">
              <input
                type="text"
                value={localSettings.embeddingModel}
                onChange={e => setLocalSettings({ ...localSettings, embeddingModel: e.target.value })}
                onBlur={() => saveSetting('embeddingModel', localSettings.embeddingModel)}
                className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/40"
              />
            </SettingField>

            <SettingField label="Context Length">
              <input
                type="number"
                value={localSettings.maxContextLength}
                onChange={e => setLocalSettings({ ...localSettings, maxContextLength: parseInt(e.target.value) || 8192 })}
                onBlur={() => saveSetting('maxContextLength', localSettings.maxContextLength)}
                className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/40"
              />
            </SettingField>

            {/* Quick setup guide */}
            {!ollamaConnected && (
              <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-xs font-mono">
                <p className="text-indigo-400 font-sans font-semibold mb-2">Recommended setup:</p>
                <p className="text-slate-400 font-sans mb-2">1. Install Ollama from <span className="text-indigo-400">ollama.ai</span></p>
                <p className="text-cyan-400">ollama pull gemma4:e4b</p>
                <p className="text-cyan-400">ollama pull nomic-embed-text</p>
              </div>
            )}
          </SettingsSection>

          {/* Privacy */}
          <SettingsSection title="Privacy & Storage" icon={<Database className="w-4 h-4 text-violet-400" />}>
            <ToggleSetting
              label="Privacy Mode"
              hint="Prevents detailed entity extraction and summarization"
              checked={localSettings.privacyMode}
              onChange={v => { setLocalSettings({ ...localSettings, privacyMode: v }); saveSetting('privacyMode', v) }}
            />

            <ToggleSetting
              label="Anonymous Telemetry"
              hint="Share anonymous usage data to improve ContextFabric"
              checked={localSettings.telemetry}
              onChange={v => { setLocalSettings({ ...localSettings, telemetry: v }); saveSetting('telemetry', v) }}
            />
          </SettingsSection>

          {/* Sync */}
          <SettingsSection title="Sync" icon={<RefreshCw className="w-4 h-4 text-cyan-400" />}>
            <ToggleSetting
              label="Auto Sync"
              hint="Automatically re-index sources on schedule"
              checked={localSettings.autoSync}
              onChange={v => { setLocalSettings({ ...localSettings, autoSync: v }); saveSetting('autoSync', v) }}
            />
          </SettingsSection>

          {/* Local API */}
          <SettingsSection title="Local Context API" icon={<Zap className="w-4 h-4 text-amber-400" />}>
            <div className="p-3.5 rounded-xl bg-cosmos-700/40 border border-white/[0.06]">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm text-white">API running on port 47821</span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Other tools can query your memory via HTTP POST to localhost:47821/api/context
              </p>
              <code className="block text-2xs bg-cosmos-700/80 rounded-lg px-3 py-2 text-cyan-400">
                {'POST localhost:47821/api/context\n{ "query": "auth system", "limit": 5 }'}
              </code>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}

function SettingsSection({ title, icon, children }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-card p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </motion.div>
  )
}

function SettingField({ label, hint, children }: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-400 block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-600 mt-1">{hint}</p>}
    </div>
  )
}

function ToggleSetting({ label, hint, checked, onChange }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm text-slate-300">{label}</div>
        {hint && <div className="text-xs text-slate-600 mt-0.5">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-10 h-5.5 rounded-full transition-colors duration-200 shrink-0',
          checked ? 'bg-indigo-600' : 'bg-cosmos-600'
        )}
        style={{ height: 22 }}
      >
        <motion.div
          animate={{ x: checked ? 18 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm"
        />
      </button>
    </div>
  )
}
