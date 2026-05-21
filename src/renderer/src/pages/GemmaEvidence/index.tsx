import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle, ArrowRight, Bot, Brain, CheckCircle2, Database,
  FileSearch, Loader2, Lock, MessageSquare, Shield, Sparkles
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import type { AIQueryResult, AppSettings, DataSource, Stats } from '../../../../shared/types'

const LIVE_CHECKS = [
  {
    id: 'project',
    title: 'Project understanding',
    prompt: 'What is this project about, and what problem is it trying to solve?',
  },
  {
    id: 'decisions',
    title: 'Decision extraction',
    prompt: 'What important technical decisions or architecture choices are present in this memory?',
  },
  {
    id: 'assistant',
    title: 'Portable context',
    prompt: 'What should another AI assistant know before helping with this project?',
  },
] as const

export default function GemmaEvidencePage(): React.ReactElement {
  const [sources, setSources] = useState<DataSource[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [history, setHistory] = useState<AIQueryResult[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<AIQueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    const [nextSources, nextStats, nextSettings, nextHistory] = await Promise.all([
      api.sources.list(),
      api.memory.getStats(),
      api.settings.get(),
      api.memory.getHistory(10),
    ])
    setSources(nextSources as DataSource[])
    setStats(nextStats as Stats)
    setSettings(nextSettings as AppSettings)
    setHistory(nextHistory as AIQueryResult[])
  }

  async function runLiveCheck(id: string, prompt: string) {
    setRunning(id)
    setError(null)
    try {
      const answer = await api.memory.query(prompt) as AIQueryResult
      setResult(answer)
      setHistory(current => [answer, ...current.filter(item => item.query !== answer.query)].slice(0, 10))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live Gemma check failed.')
    } finally {
      setRunning(null)
    }
  }

  const readySources = sources.filter(source => source.status === 'ready')
  const liveResult = result || history[0] || null
  const modelName = settings?.ollamaModel || 'gemma4:e4b'
  const health = useMemo(() => {
    if (!stats || stats.totalNodes === 0) return 'needs_data'
    if (!stats.ollamaConnected) return 'search_only'
    return 'ready'
  }, [stats])

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300">
              <Sparkles className="h-3.5 w-3.5" />
              Real Gemma 4 evidence
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Prove Gemma is doing real work</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              This page does not use demo data. It checks the sources you actually imported and runs live questions against your current memory graph.
            </p>
          </div>

          <StatusPill health={health} connected={Boolean(stats?.ollamaConnected)} />
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard icon={Database} label="Indexed nodes" value={stats?.totalNodes.toLocaleString() || '0'} />
          <MetricCard icon={FileSearch} label="Ready sources" value={readySources.length.toLocaleString()} />
          <MetricCard icon={Brain} label="Entities" value={stats?.totalEntities.toLocaleString() || '0'} />
          <MetricCard icon={Bot} label="Model" value={modelName} />
        </div>

        {health !== 'ready' && (
          <div className={cn(
            'mt-5 rounded-2xl border p-4',
            health === 'needs_data'
              ? 'border-amber-500/20 bg-amber-500/8'
              : 'border-indigo-500/20 bg-indigo-500/8'
          )}>
            <div className="flex items-start gap-3">
              <AlertCircle className={cn('mt-0.5 h-5 w-5', health === 'needs_data' ? 'text-amber-300' : 'text-indigo-300')} />
              <div>
                <div className="text-sm font-semibold text-white">
                  {health === 'needs_data' ? 'Add and sync a real source first' : 'Gemma is not connected right now'}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  {health === 'needs_data'
                    ? 'Go to Sources, add this project folder or another real source, then sync it. This page will update from that indexed memory.'
                    : 'The live checks will still use local retrieval and extractive fallback, but the challenge version is strongest when Ollama is running Gemma.'}
                </p>
              </div>
            </div>
          </div>
        )}

        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_420px]">
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Run live evidence checks</h2>
              <p className="mt-1 text-sm text-slate-500">Each button asks the current memory graph a real question. Answers and citations come from your indexed sources.</p>
            </div>

            {LIVE_CHECKS.map(check => (
              <button
                key={check.id}
                onClick={() => runLiveCheck(check.id, check.prompt)}
                disabled={running !== null || !stats || stats.totalNodes === 0}
                className="group w-full rounded-2xl border border-white/[0.07] bg-cosmos-800 p-4 text-left transition hover:border-indigo-500/30 hover:bg-cosmos-700/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                    {running === check.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageSquare className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white">{check.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{check.prompt}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-600 transition group-hover:text-indigo-300" />
                </div>
              </button>
            ))}

            {error && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <aside className="rounded-2xl border border-white/[0.07] bg-cosmos-800 p-5">
            <h2 className="text-lg font-semibold text-white">Why this is not hardcoded</h2>
            <div className="mt-4 space-y-3">
              {[
                { icon: Database, title: 'Uses your indexed DB', text: `${stats?.totalNodes || 0} current memory nodes, not bundled demo rows.` },
                { icon: FileSearch, title: 'Cites real sources', text: 'Evidence comes from synced folders, exports, repos, and documents.' },
                { icon: Lock, title: 'Permissioned output', text: 'The same local API/token flow can serve approved context to external AI tools.' },
                { icon: Shield, title: 'Private by default', text: 'Normal operation stays on the local machine.' },
              ].map(item => (
                <div key={item.title} className="flex gap-3 rounded-xl bg-white/[0.03] p-3">
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                  <div>
                    <div className="text-sm font-medium text-white">{item.title}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className="mt-8 rounded-2xl border border-white/[0.07] bg-cosmos-800 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Latest live result</h2>
              <p className="mt-1 text-sm text-slate-500">This panel reflects the latest actual query result saved by the app.</p>
            </div>
            {liveResult && (
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                {Math.round(liveResult.confidence)}% confidence
              </span>
            )}
          </div>

          {liveResult ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Question</div>
                <p className="rounded-xl bg-cosmos-900/70 p-3 text-sm text-slate-300">{liveResult.query}</p>
                <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Answer</div>
                <p className="whitespace-pre-wrap rounded-xl bg-cosmos-900/70 p-4 text-sm leading-7 text-slate-200">{liveResult.answer}</p>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Sources used</div>
                <div className="space-y-2">
                  {(liveResult.sources || []).slice(0, 5).map((source, index) => (
                    <div key={`${sourceKey(source)}-${index}`} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                      <div className="text-sm font-medium text-white">{sourceTitle(source)}</div>
                      <div className="mt-1 text-xs text-slate-500">{sourceName(source)}</div>
                    </div>
                  ))}
                  {(!liveResult.sources || liveResult.sources.length === 0) && (
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-sm text-slate-500">
                      No citations attached to this result.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-cosmos-900/70 p-5 text-sm text-slate-500">
              Run a live evidence check after syncing a real source.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-cosmos-800 p-4">
      <Icon className="mb-3 h-5 w-5 text-indigo-300" />
      <div className="text-xs uppercase tracking-wider text-slate-600">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function StatusPill({ health, connected }: { health: string; connected: boolean }) {
  const config = health === 'ready'
    ? { label: 'Live with Gemma', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' }
    : health === 'search_only'
      ? { label: 'Search fallback', className: 'bg-amber-500/10 text-amber-300 border-amber-500/20' }
      : { label: 'Needs synced data', className: 'bg-slate-500/10 text-slate-300 border-white/[0.08]' }

  return (
    <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium', config.className)}>
      {health === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {config.label}
      <span className="text-slate-500">/</span>
      {connected ? 'Ollama connected' : 'Ollama offline'}
    </div>
  )
}

function sourceKey(source: unknown): string {
  const item = source as { node?: { id?: string }; id?: string; title?: string } | undefined
  return item?.node?.id || item?.id || item?.title || 'source'
}

function sourceTitle(source: unknown): string {
  const item = source as { node?: { title?: string }; title?: string; source?: string } | undefined
  return item?.node?.title || item?.title || item?.source || 'Source evidence'
}

function sourceName(source: unknown): string {
  const item = source as {
    node?: { sourceName?: string; sourceType?: string }
    sourceName?: string
    source?: string
    type?: string
  } | undefined
  return item?.node?.sourceName || item?.sourceName || item?.source || item?.node?.sourceType || item?.type || 'Indexed memory'
}
