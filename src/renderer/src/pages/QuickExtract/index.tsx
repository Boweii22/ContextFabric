import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, Database, Loader2, Search, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'
import { getTypeColor } from '../../lib/utils'
import type { DataSource, MemoryNode, SearchResult } from '../../../../shared/types'

interface QuickExtractResult {
  source: DataSource
  rawNode: MemoryNode
  nodes: MemoryNode[]
  savedCount: number
}

const SAMPLE = `ContextFabric is a local-first AI memory layer for the Gemma 4 Challenge.

Preference: keep private context local and avoid cloud egress.
Style: answers should be practical, clear, and source-cited.
Decision: use a local SQLite graph database with permission tokens so AI tools only receive approved context.`

export default function QuickExtractPage(): React.ReactElement {
  const [title, setTitle] = useState('Quick Context Profile')
  const [text, setText] = useState(SAMPLE)
  const [result, setResult] = useState<QuickExtractResult | null>(null)
  const [matches, setMatches] = useState<SearchResult[]>([])
  const [query, setQuery] = useState('local privacy memory graph')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function extract() {
    setLoading(true)
    setError(null)
    setMatches([])
    try {
      const next = await api.memory.quickExtract(text, title) as QuickExtractResult
      setResult(next)
      const found = await api.memory.search(query, 8) as SearchResult[]
      setMatches(found)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick extraction failed.')
    } finally {
      setLoading(false)
    }
  }

  async function runSearch() {
    const found = await api.memory.search(query, 8) as SearchResult[]
    setMatches(found)
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-300">
            <Sparkles className="h-3.5 w-3.5" />
            Paste text to memory
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Quick Extract</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Paste real context, run Gemma 4 extraction, save typed nodes to SQLite, then search them immediately.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Title</label>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/[0.08] bg-cosmos-900 px-4 py-3 text-sm text-white outline-none focus:border-teal-400/50"
            />

            <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Text</label>
            <textarea
              value={text}
              onChange={event => setText(event.target.value)}
              className="mt-2 min-h-[320px] w-full resize-none rounded-xl border border-white/[0.08] bg-cosmos-900 px-4 py-3 text-sm leading-6 text-white outline-none focus:border-teal-400/50"
            />

            {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

            <button
              onClick={extract}
              disabled={loading || text.trim().length < 20}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              Extract with Gemma 4
            </button>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                <Database className="h-4 w-4 text-teal-300" />
                Saved Nodes
              </div>
              {!result ? (
                <p className="text-sm leading-6 text-slate-400">Extracted nodes will appear here after saving.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400">Saved {result.savedCount} node(s) to SQLite source "{result.source.name}".</p>
                  {result.nodes.map(node => (
                    <motion.div key={node.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-white/[0.06] bg-cosmos-900/70 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getTypeColor(node.type) }} />
                        <span className="text-sm font-semibold text-white">{node.title}</span>
                        <span className="ml-auto text-xs text-slate-500">{Math.round(node.confidence * 100)}%</span>
                      </div>
                      <p className="text-sm leading-6 text-slate-400">{node.summary || node.content}</p>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                <Search className="h-4 w-4 text-indigo-300" />
                Query Saved Graph
              </div>
              <div className="flex gap-2">
                <input value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-cosmos-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/50" />
                <button onClick={runSearch} className="rounded-xl bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400">Search</button>
              </div>
              <div className="mt-4 space-y-2">
                {matches.slice(0, 5).map(match => (
                  <div key={match.node.id} className="rounded-xl border border-white/[0.06] bg-cosmos-900/70 p-3">
                    <div className="text-sm font-medium text-white">{match.node.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{match.node.type} · score {match.score.toFixed(2)}</div>
                    <p className="mt-2 text-sm text-slate-400">{(match.node.summary || match.node.content).slice(0, 180)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
