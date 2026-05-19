import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Database, Plus, Trash2, RefreshCw, AlertCircle, Check,
  MessageSquare, FileText, Code2, Folder, Github, BookOpen,
  ToggleLeft, ToggleRight, ChevronRight, Clock, Loader2,
  FolderOpen, Upload
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { formatDate, cn } from '../../lib/utils'
import type { DataSource } from '../../../../shared/types'

const SOURCE_CONFIGS = {
  claude_export: { label: 'Claude Export', icon: MessageSquare, color: '#6366F1', desc: 'claude.ai → Settings → Privacy & Data → Export Data → JSON (instant download)' },
  chatgpt_export: { label: 'ChatGPT Export', icon: MessageSquare, color: '#10A37F', desc: 'Settings → Data Controls → Export → email with zip. Takes days — use local folder as workaround' },
  local_folder: { label: 'Local Folder', icon: Folder, color: '#F59E0B', desc: 'Point to any folder — indexes .md .txt .ts .js .py .go .json .yaml recursively' },
  github_repo: { label: 'GitHub / Git Repo', icon: Github, color: '#6E40C9', desc: 'Point to a local git clone — indexes source files and docs (not commit history)' },
  markdown: { label: 'Obsidian / Markdown', icon: FileText, color: '#06B6D4', desc: 'Point to your Obsidian vault folder — all .md files indexed recursively' },
  pdf: { label: 'PDF Document', icon: FileText, color: '#EF4444', desc: 'Single PDF file — text extracted and chunked for semantic search' },
  notion_export: { label: 'Notion Export', icon: BookOpen, color: '#E2E8F0', desc: 'Settings → Workspace → Export all workspace content → Markdown. Email delivery, may take hours' },
  vscode_workspace: { label: 'VSCode Workspace', icon: Code2, color: '#007ACC', desc: 'Point to your project root — indexes source files (Copilot chat history not accessible)' },
} as const

type SourceType = keyof typeof SOURCE_CONFIGS

export default function SourcesPage(): React.ReactElement {
  const { sources, setSources, updateSource, processingStatuses } = useAppStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function handleSync(id: string) {
    updateSource(id, { status: 'indexing' })
    try {
      await api.sources.sync(id)
    } catch (err) {
      updateSource(id, { status: 'error' })
    }
  }

  async function handleDelete(id: string) {
    await api.sources.remove(id)
    const updated = await api.sources.list() as DataSource[]
    setSources(updated)
    setConfirmDelete(null)
  }

  async function handleToggle(id: string, enabled: boolean) {
    updateSource(id, { enabled })
    await api.sources.toggle(id, enabled)
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Data Sources</h1>
            <p className="text-sm text-slate-500 mt-1">Connect and manage your knowledge sources</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2.5 rounded-xl transition-all shadow-glow"
          >
            <Plus className="w-4 h-4" />
            Add Source
          </button>
        </div>

        {/* Sources list */}
        {sources.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 rounded-3xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
              <Database className="w-10 h-10 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No sources connected</h3>
            <p className="text-sm text-slate-500 mb-6">Connect your first data source to start building your unified memory.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-xl transition-all shadow-glow"
            >
              <Plus className="w-4 h-4" />
              Add Your First Source
            </button>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {sources.map((source, i) => (
              <SourceCard
                key={source.id}
                source={source}
                processingStatus={processingStatuses[source.id]}
                onSync={() => handleSync(source.id)}
                onDelete={() => setConfirmDelete(source.id)}
                onToggle={(enabled) => handleToggle(source.id, enabled)}
                animDelay={i * 0.05}
              />
            ))}
          </div>
        )}

        {/* Add source modal */}
        <AnimatePresence>
          {showAddModal && (
            <AddSourceModal
              onClose={() => setShowAddModal(false)}
              onAdd={async (data) => {
                await api.sources.add(data)
                const updated = await api.sources.list() as DataSource[]
                setSources(updated)
                setShowAddModal(false)
              }}
            />
          )}
        </AnimatePresence>

        {/* Delete confirmation */}
        <AnimatePresence>
          {confirmDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
              onClick={() => setConfirmDelete(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-cosmos-800 border border-white/[0.1] rounded-2xl p-6 w-80"
                onClick={e => e.stopPropagation()}
              >
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
                  <Trash2 className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="font-semibold text-white mb-2">Delete this source?</h3>
                <p className="text-sm text-slate-400 mb-6">
                  All indexed data from this source will be permanently removed from your memory.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.1] text-slate-300 hover:bg-white/[0.04] text-sm transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDelete(confirmDelete)}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-all"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function SourceCard({
  source, processingStatus, onSync, onDelete, onToggle, animDelay
}: {
  source: DataSource
  processingStatus?: { phase: string; progress: number; total: number; message: string }
  onSync: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
  animDelay: number
}) {
  const config = SOURCE_CONFIGS[source.type as SourceType]
  const Icon = config?.icon || Database
  const isProcessing = source.status === 'indexing'
  const progress = processingStatus ? (processingStatus.progress / processingStatus.total) * 100 : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: animDelay }}
      className={cn(
        'p-5 rounded-2xl border transition-all duration-200',
        source.enabled
          ? 'bg-cosmos-800 border-white/[0.06] hover:border-white/[0.1]'
          : 'bg-cosmos-800/50 border-white/[0.03] opacity-60'
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${config?.color || '#6366F1'}15` }}
        >
          <Icon className="w-5 h-5" style={{ color: config?.color || '#6366F1' }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-white text-sm">{source.name}</h3>
            <StatusBadge status={source.status} />
          </div>

          <p className="text-xs text-slate-500 truncate mb-1">{source.path}</p>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>{source.nodeCount.toLocaleString()} nodes</span>
            {source.lastSynced && (
              <>
                <span>·</span>
                <span>Synced {formatDate(source.lastSynced)}</span>
              </>
            )}
            <span>·</span>
            <span>{config?.label || source.type}</span>
          </div>

          {/* Progress bar */}
          {isProcessing && processingStatus && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-2xs text-indigo-400">{processingStatus.message}</span>
                <span className="text-2xs text-slate-600">{processingStatus.progress}/{processingStatus.total}</span>
              </div>
              <div className="h-1 bg-cosmos-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-indigo-500 rounded-full"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onToggle(!source.enabled)}
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-all',
              source.enabled
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-slate-600 hover:bg-white/[0.05]'
            )}
            title={source.enabled ? 'Disable' : 'Enable'}
          >
            {source.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          </button>

          <button
            onClick={onSync}
            disabled={isProcessing}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all disabled:opacity-40"
            title="Sync now"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={onDelete}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
            title="Delete source"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function StatusBadge({ status }: { status: DataSource['status'] }) {
  const config = {
    idle: { label: 'Idle', className: 'bg-slate-500/10 text-slate-500' },
    indexing: { label: 'Indexing', className: 'bg-amber-500/10 text-amber-400' },
    ready: { label: 'Ready', className: 'bg-emerald-500/10 text-emerald-400' },
    error: { label: 'Error', className: 'bg-red-500/10 text-red-400' },
  }
  const c = config[status]

  return (
    <span className={cn('text-2xs px-2 py-0.5 rounded-full font-medium', c.className)}>
      {status === 'indexing' && <Loader2 className="inline w-2 h-2 animate-spin mr-1" />}
      {c.label}
    </span>
  )
}

function AddSourceModal({ onClose, onAdd }: { onClose: () => void; onAdd: (data: Omit<DataSource, 'id' | 'status' | 'nodeCount'>) => Promise<void> }) {
  const [selectedType, setSelectedType] = useState<SourceType | null>(null)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleAdd() {
    if (!selectedType || !name.trim() || !path.trim()) return
    setAdding(true)
    try {
      const config = SOURCE_CONFIGS[selectedType]
      await onAdd({
        name: name.trim(),
        type: selectedType,
        path: path.trim(),
        color: config.color,
        icon: selectedType,
        enabled: true,
        metadata: {},
      })
    } finally {
      setAdding(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="bg-cosmos-800 border border-white/[0.1] rounded-3xl p-6 w-[560px] max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-1">Add Data Source</h2>
        <p className="text-sm text-slate-500 mb-6">Connect a new knowledge source to your memory</p>

        {/* Type selection */}
        {!selectedType ? (
          <div className="grid grid-cols-2 gap-2.5">
            {(Object.entries(SOURCE_CONFIGS) as [SourceType, typeof SOURCE_CONFIGS[SourceType]][]).map(([type, config]) => (
              <button
                key={type}
                onClick={() => {
                  setSelectedType(type)
                  setName(config.label)
                }}
                className="flex items-start gap-3 p-4 rounded-xl border border-white/[0.06] hover:border-indigo-500/25 hover:bg-indigo-500/5 transition-all text-left"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${config.color}15` }}
                >
                  <config.icon className="w-4 h-4" style={{ color: config.color }} />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{config.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{config.desc}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Back */}
            <button
              onClick={() => { setSelectedType(null); setName(''); setPath('') }}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
            >
              ← Back
            </button>

            {/* Selected type */}
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-cosmos-700/50 border border-white/[0.06]">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${SOURCE_CONFIGS[selectedType].color}15` }}
              >
                {React.createElement(SOURCE_CONFIGS[selectedType].icon, {
                  className: 'w-4 h-4',
                  style: { color: SOURCE_CONFIGS[selectedType].color }
                })}
              </div>
              <div>
                <div className="text-sm font-medium text-white">{SOURCE_CONFIGS[selectedType].label}</div>
                <div className="text-xs text-slate-500">{SOURCE_CONFIGS[selectedType].desc}</div>
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="My Claude Conversations"
                className="w-full bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/40"
              />
            </div>

            {/* Path */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">
                {selectedType === 'claude_export' || selectedType === 'chatgpt_export' || selectedType === 'pdf' ? 'File Path' : 'Directory Path'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={path}
                  onChange={e => setPath(e.target.value)}
                  placeholder={
                    selectedType === 'claude_export' ? 'C:/Users/you/Downloads/claude_export.json' :
                    selectedType === 'chatgpt_export' ? 'C:/Users/you/Downloads/chatgpt-export/conversations.json' :
                    selectedType === 'markdown' ? 'C:/Users/you/Documents/MyObsidianVault' :
                    selectedType === 'notion_export' ? 'C:/Users/you/Downloads/notion-export-extracted' :
                    selectedType === 'github_repo' ? 'C:/Users/you/code/my-repo' :
                    selectedType === 'vscode_workspace' ? 'C:/Users/you/code/my-project' :
                    selectedType === 'pdf' ? 'C:/Users/you/Documents/notes.pdf' :
                    'C:/Users/you/path/to/folder'
                  }
                  className="flex-1 bg-cosmos-700/50 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/40"
                />
              </div>
              <p className="text-xs text-slate-600 mt-1.5">Enter the full path to the file or directory on your machine</p>
            </div>

            {/* Instructions */}
            {selectedType === 'claude_export' && (
              <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-xs text-slate-400 space-y-1">
                <p><strong className="text-indigo-400">How to get your export:</strong></p>
                <p>1. Go to <strong className="text-white">claude.ai</strong></p>
                <p>2. Click your profile → <strong className="text-white">Settings</strong></p>
                <p>3. <strong className="text-white">Privacy & Data</strong> → <strong className="text-white">Export Data</strong></p>
                <p>4. Download the <code className="text-cyan-400">.json</code> file and point to it here</p>
                <p className="text-slate-500 pt-1">Export is instant — no waiting.</p>
              </div>
            )}

            {selectedType === 'chatgpt_export' && (
              <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-slate-400 space-y-1">
                <p><strong className="text-amber-400">⚠ Official export takes days:</strong></p>
                <p>ChatGPT → Settings → <strong className="text-white">Data Controls</strong> → <strong className="text-white">Export data</strong> → Confirm via email → OpenAI sends a second email with a download link. Can take <strong className="text-white">hours to several days</strong>.</p>
                <p>Once you get the zip, extract it and point to <code className="text-cyan-400">conversations.json</code>.</p>
                <p className="text-slate-500 pt-1">Workaround: copy-paste important chats into .md files and use Local Folder instead.</p>
              </div>
            )}

            {selectedType === 'notion_export' && (
              <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-xs text-slate-400 space-y-1">
                <p><strong className="text-indigo-400">How to export:</strong></p>
                <p>1. Notion → <strong className="text-white">Settings & Members</strong> → <strong className="text-white">Settings</strong></p>
                <p>2. Scroll to <strong className="text-white">Export all workspace content</strong></p>
                <p>3. Choose <strong className="text-white">Markdown & CSV</strong> → Export</p>
                <p>4. Notion emails you a download link (may take minutes to hours for large workspaces)</p>
                <p>5. Extract the zip and point to the extracted folder here</p>
              </div>
            )}

            {selectedType === 'markdown' && (
              <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-xs text-slate-400 space-y-1">
                <p><strong className="text-indigo-400">Obsidian vault:</strong> Point directly to your vault folder (e.g. <code className="text-cyan-400">~/Documents/MyVault</code>). All <code className="text-cyan-400">.md</code> files are indexed recursively.</p>
                <p className="text-slate-500">You don't need to export anything — just use the live vault path.</p>
              </div>
            )}

            {selectedType === 'github_repo' && (
              <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-xs text-slate-400 space-y-1">
                <p><strong className="text-indigo-400">Use a local clone:</strong></p>
                <p><code className="text-cyan-400">git clone https://github.com/you/repo</code></p>
                <p>Then point to the cloned folder. Source files and docs are indexed — commit history is not.</p>
              </div>
            )}

            {selectedType === 'vscode_workspace' && (
              <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-xs text-slate-400 space-y-1">
                <p><strong className="text-indigo-400">Point to your project root</strong> — the same folder you open in VSCode.</p>
                <p>Source files (<code className="text-cyan-400">.ts .js .py .go</code> etc.) and docs are indexed. VSCode Copilot chat history is stored internally by the extension and not readable as files.</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-white/[0.1] text-slate-300 hover:bg-white/[0.04] text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!name.trim() || !path.trim() || adding}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
              >
                {adding ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Add Source
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
