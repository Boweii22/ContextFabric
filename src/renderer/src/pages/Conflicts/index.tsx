import React, { useEffect, useState } from 'react'
import { AlertTriangle, Check, GitCompare, HelpCircle, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { MemoryConflict } from '../../../../shared/types'

const ACTIONS = [
  ['accepted_new', 'Accept new', Check],
  ['kept_existing', 'Keep existing', X],
  ['kept_both', 'Keep both', GitCompare],
  ['dismissed', 'Dismiss', HelpCircle],
] as const

export default function ConflictsPage(): React.ReactElement {
  const [conflicts, setConflicts] = useState<MemoryConflict[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { void refresh() }, [])

  async function refresh() {
    setLoading(true)
    setConflicts(await api.conflicts.list('open', 100) as MemoryConflict[])
    setLoading(false)
  }

  async function resolve(id: string, status: MemoryConflict['status']) {
    await api.conflicts.resolve(id, status as 'accepted_new' | 'kept_existing' | 'kept_both' | 'dismissed')
    await refresh()
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Conflict review
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Memory Conflicts</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Review contradictions or uncertain overlaps found while new project, decision, style, and preference nodes are indexed.
          </p>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-6 text-sm text-slate-400">Loading conflicts...</div>
        ) : conflicts.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-6">
            <div className="text-sm font-semibold text-white">No open conflicts</div>
            <p className="mt-2 text-sm text-slate-400">Sync sources with contradictory preferences or decisions to test this flow.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {conflicts.map(conflict => (
              <article key={conflict.id} className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">{conflict.type}</span>
                  {conflict.maybe && <span className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-300">maybe</span>}
                  <span className="text-xs text-slate-500">{Math.round(conflict.confidence * 100)}% confidence · {conflict.severity}</span>
                </div>

                <p className="mb-4 text-sm leading-6 text-slate-300">{conflict.reason}</p>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/[0.06] bg-cosmos-900/70 p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Existing memory</div>
                    <p className="text-sm leading-6 text-slate-300">{conflict.existingSummary}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-cosmos-900/70 p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">New memory</div>
                    <p className="text-sm leading-6 text-slate-300">{conflict.newSummary}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {ACTIONS.map(([status, label, Icon]) => (
                    <button
                      key={status}
                      onClick={() => resolve(conflict.id, status)}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-slate-300 transition hover:border-indigo-400/40 hover:text-white"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
