import React, { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import type { MemoryNode } from '../../../../shared/types'

export default function RecoveryPage(): React.ReactElement {
  const [nodes, setNodes] = useState<MemoryNode[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { void refresh() }, [])

  async function refresh() {
    setLoading(true)
    setNodes(await api.memory.deleted(100) as MemoryNode[])
    setLoading(false)
  }

  async function restore(id: string) {
    await api.memory.restoreNode(id)
    await refresh()
  }

  async function purge() {
    await api.memory.purgeExpired()
    await refresh()
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300">
              <RotateCcw className="h-3.5 w-3.5" />
              30-day recovery
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Deleted Memory</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Soft-deleted nodes stay recoverable for 30 days before expired records can be purged.
            </p>
          </div>
          <button onClick={purge} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-slate-300 hover:text-white">
            <Trash2 className="h-4 w-4" />
            Purge expired
          </button>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-6 text-sm text-slate-400">Loading deleted memory...</div>
        ) : nodes.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-6">
            <div className="text-sm font-semibold text-white">Nothing to recover</div>
            <p className="mt-2 text-sm text-slate-400">Deleted nodes from the last 30 days will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {nodes.map(node => (
              <article key={node.id} className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-white">{node.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{node.type} · {node.sourceName} · {Math.round(node.confidence * 100)}% confidence</div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{(node.summary || node.content).slice(0, 260)}</p>
                  </div>
                  <button onClick={() => restore(node.id)} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400">
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
