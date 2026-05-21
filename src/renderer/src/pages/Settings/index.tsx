import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Settings, Server, Brain, Database, RefreshCw, Check,
  AlertCircle, Zap, ChevronRight, Loader2, Eye, EyeOff
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { cn } from '../../lib/utils'
import type { AppSettings, CRSQLiteStatus, SyncRunResult } from '../../../../shared/types'

export default function SettingsPage(): React.ReactElement {
  const { settings, setSettings, ollamaConnected, setOllamaConnected } = useAppStore()
  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [testingOllama, setTestingOllama] = useState(false)
  const [models, setModels] = useState<Array<{ name: string }>>([])
  const [syncStatus, setSyncStatus] = useState<CRSQLiteStatus | null>(null)
  const [syncRunning, setSyncRunning] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  useEffect(() => {
    if (settings) setLocalSettings({ ...settings })
    loadModels()
    loadSyncStatus()
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

  async function loadSyncStatus() {
    try {
      setSyncStatus(await api.sync.status() as CRSQLiteStatus)
    } catch {
      setSyncStatus(null)
    }
  }

  async function runDeviceSync() {
    if (!localSettings?.syncPeerUrl || !localSettings.syncPeerKey) {
      setSyncResult('Enter a peer URL and sync key first.')
      return
    }
    setSyncRunning(true)
    setSyncResult(null)
    try {
      await saveSetting('syncPeerUrl', localSettings.syncPeerUrl)
      await saveSetting('syncPeerKey', localSettings.syncPeerKey)
      const result = await api.sync.run(localSettings.syncPeerUrl, localSettings.syncPeerKey) as SyncRunResult
      setSyncResult(result.message)
      await loadSyncStatus()
    } catch (error) {
      setSyncResult(error instanceof Error ? error.message : 'Sync failed.')
    } finally {
      setSyncRunning(false)
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

            <SettingField label="AI Model" hint="Strict Gemma 4 mode uses cf-gemma4; close heavy apps before querying on 16 GB RAM">
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

          {/* Google Gemini fallback */}
          <SettingsSection title="Cloud AI Fallback (Google Gemini)" icon={<Zap className="w-4 h-4 text-emerald-400" />}>
            <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15 text-xs mb-3">
              <p className="text-emerald-400 font-semibold mb-1">Fix for RAM-limited machines</p>
              <p className="text-slate-400">Strict local Gemma 4 mode does not use this automatically. Keep this blank unless you intentionally want a cloud fallback later.</p>
            </div>
            <SettingField label="Google AI Studio API Key" hint="Paste your key — stored locally, never shared">
              <input
                type="password"
                value={(localSettings as AppSettings & { geminiApiKey?: string }).geminiApiKey || ''}
                onChange={e => setLocalSettings({ ...localSettings, geminiApiKey: e.target.value } as AppSettings)}
                onBlur={() => saveSetting('geminiApiKey' as keyof AppSettings, (localSettings as AppSettings & { geminiApiKey?: string }).geminiApiKey || '')}
                placeholder="AIza..."
                className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/40 font-mono"
              />
            </SettingField>
            <SettingField label="Gemini Model" hint="Default: gemma-3-27b-it — check aistudio.google.com for available Gemma models">
              <input
                type="text"
                value={(localSettings as AppSettings & { geminiModel?: string }).geminiModel || 'gemma-3-27b-it'}
                onChange={e => setLocalSettings({ ...localSettings, geminiModel: e.target.value } as AppSettings)}
                onBlur={() => saveSetting('geminiModel' as keyof AppSettings, (localSettings as AppSettings & { geminiModel?: string }).geminiModel || 'gemma-3-27b-it')}
                className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/40"
              />
            </SettingField>
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

            <div className="p-3.5 rounded-xl bg-cosmos-700/40 border border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">CR-SQLite device sync</div>
                  <div className="text-xs text-slate-500">
                    {syncStatus?.enabled ? `DB version ${syncStatus.dbVersion}` : syncStatus?.lastError || 'Checking sync engine...'}
                  </div>
                </div>
                <div className={cn(
                  'px-2 py-1 rounded-md text-xs',
                  syncStatus?.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                )}>
                  {syncStatus?.enabled ? 'Enabled' : 'Offline'}
                </div>
              </div>

              <SettingField label="This device URL" hint="Use one of these on your other device">
                <div className="space-y-1">
                  {(syncStatus?.lanUrls.length ? syncStatus.lanUrls : [`http://<this-device-ip>:${syncStatus?.lanPort || 47822}`]).map(url => (
                    <code key={url} className="block text-2xs bg-cosmos-700/80 rounded-lg px-3 py-2 text-cyan-300 break-all">{url}</code>
                  ))}
                </div>
              </SettingField>

              <SettingField label="This device sync key" hint="Share only with your own devices">
                <input
                  type="password"
                  readOnly
                  value={syncStatus?.syncKey || ''}
                  className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none font-mono"
                />
              </SettingField>

              <SettingField label="Peer device URL">
                <input
                  type="text"
                  value={localSettings.syncPeerUrl || ''}
                  onChange={e => setLocalSettings({ ...localSettings, syncPeerUrl: e.target.value })}
                  placeholder="http://192.168.1.23:47822"
                  className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/40"
                />
              </SettingField>

              <SettingField label="Peer sync key">
                <input
                  type="password"
                  value={localSettings.syncPeerKey || ''}
                  onChange={e => setLocalSettings({ ...localSettings, syncPeerKey: e.target.value })}
                  placeholder="Paste the other device key"
                  className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/40 font-mono"
                />
              </SettingField>

              <button
                onClick={runDeviceSync}
                disabled={syncRunning || !syncStatus?.enabled}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cyan-500/30 text-xs text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50 transition-all"
              >
                {syncRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Sync with peer
              </button>

              {syncResult && <p className="text-xs text-slate-400">{syncResult}</p>}
              {syncStatus?.peers.length ? (
                <div className="space-y-1">
                  {syncStatus.peers.slice(0, 3).map(peer => (
                    <div key={peer.peerSiteId} className="text-2xs text-slate-500">
                      Peer {peer.peerSiteId.slice(0, 12)} · received v{peer.lastReceivedDbVersion} · sent v{peer.lastSentDbVersion}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
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
