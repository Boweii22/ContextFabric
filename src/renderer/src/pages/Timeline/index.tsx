import React, { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Zap, CheckCircle, TrendingUp, Search, GitBranch, ChevronDown, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { formatDate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { MemoryNode, SearchResult, TimelineEvent } from '../../../../shared/types'

const EVENT_ICONS: Record<TimelineEvent['type'], React.ReactNode> = {
  decision: <Zap className="w-3.5 h-3.5" />,
  milestone: <CheckCircle className="w-3.5 h-3.5" />,
  pivot: <TrendingUp className="w-3.5 h-3.5" />,
  discovery: <Search className="w-3.5 h-3.5" />,
  rejection: <GitBranch className="w-3.5 h-3.5" />,
  adoption: <CheckCircle className="w-3.5 h-3.5" />,
}

const EVENT_COLORS: Record<TimelineEvent['type'], string> = {
  decision: '#F59E0B',
  milestone: '#10B981',
  pivot: '#6366F1',
  discovery: '#06B6D4',
  rejection: '#EF4444',
  adoption: '#8B5CF6',
}

const SIGNIFICANCE_STYLES = {
  high: 'border-l-2 border-amber-500/50',
  medium: 'border-l-2 border-indigo-500/30',
  low: 'border-l-2 border-white/[0.06]',
}

export default function TimelinePage(): React.ReactElement {
  const { timeline, setTimeline } = useAppStore()
  const [localTimeline, setLocalTimeline] = useState<TimelineEvent[]>(timeline)
  const [loading, setLoading] = useState(true)
  const [usingDerivedEvents, setUsingDerivedEvents] = useState(false)
  const [filter, setFilter] = useState<TimelineEvent['type'] | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadTimeline = useCallback(async () => {
    setLoading(true)
    try {
      const events = await api.memory.getTimeline(200) as TimelineEvent[]
      if (events.length > 0) {
        setTimeline(events)
        setLocalTimeline(events)
        setUsingDerivedEvents(false)
        return
      }

      const recent = await api.memory.search('', 200) as SearchResult[]
      const derived = deriveTimelineFromNodes(recent.map(r => r.node))
      setLocalTimeline(derived)
      setUsingDerivedEvents(derived.length > 0)
    } catch (error) {
      console.error('[Timeline] Failed to load timeline:', error)
      setLocalTimeline(current => current.length > 0 ? current : timeline)
      setUsingDerivedEvents(false)
    } finally {
      setLoading(false)
    }
  }, [setTimeline])

  useEffect(() => { loadTimeline() }, [loadTimeline])

  const filtered = localTimeline.filter(event => {
    if (filter && event.type !== filter) return false
    if (search && !event.title.toLowerCase().includes(search.toLowerCase()) &&
        !event.description.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Group by month
  const groups = new Map<string, TimelineEvent[]>()
  for (const event of filtered) {
    const date = new Date(event.timestamp)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(event)
  }

  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a))

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Timeline</h1>
            <p className="text-sm text-slate-500 mt-1">
              {usingDerivedEvents
                ? 'Built from your indexed memories while decision extraction catches up'
                : 'How your thinking evolved over time'}
            </p>
          </div>
          <button
            onClick={loadTimeline}
            className="w-8 h-8 rounded-lg border border-white/[0.06] text-slate-500 hover:text-white hover:border-white/[0.12] flex items-center justify-center transition-all"
            title="Refresh timeline"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>

        {usingDerivedEvents && (
          <div className="mb-5 rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] px-3 py-2 text-xs text-cyan-200/80">
            Showing memory activity because no extracted decision events are stored yet.
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search events..."
              className="w-full bg-cosmos-800 border border-white/[0.06] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/40"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {(['decision', 'milestone', 'pivot', 'rejection', 'adoption'] as const).map(type => (
              <button
                key={type}
                onClick={() => setFilter(filter === type ? null : type)}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all capitalize',
                  filter === type
                    ? 'text-white'
                    : 'text-slate-500 hover:text-slate-300'
                )}
                style={filter === type ? {
                  backgroundColor: `${EVENT_COLORS[type]}20`,
                  color: EVENT_COLORS[type],
                } : undefined}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="text-center py-20">
            <Clock className="w-8 h-8 text-indigo-400 mx-auto mb-4 animate-pulse" />
            <p className="text-sm text-slate-500">Loading timeline...</p>
          </div>
        ) : localTimeline.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No timeline events yet</h3>
            <p className="text-sm text-slate-500">
              Index sources with Ollama connected to extract decisions and milestones automatically.
            </p>
          </div>
        ) : sortedGroups.length === 0 ? (
          <div className="text-center py-12 text-slate-600 text-sm">No events match your filter</div>
        ) : (
          <div className="space-y-8">
            {sortedGroups.map(([key, events]) => {
              const date = new Date(events[0].timestamp)
              const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

              return (
                <div key={key}>
                  {/* Month label */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="text-sm font-semibold text-slate-400">{monthLabel}</div>
                    <div className="flex-1 h-px bg-white/[0.05]" />
                    <span className="text-xs text-slate-600">{events.length} events</span>
                  </div>

                  {/* Events */}
                  <div className="relative pl-6">
                    {/* Vertical line */}
                    <div className="absolute left-2 top-0 bottom-0 w-px bg-white/[0.06]" />

                    <div className="space-y-3">
                      {events.map((event, i) => (
                        <motion.div
                          key={event.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="relative"
                        >
                          {/* Timeline dot */}
                          <div
                            className="absolute -left-[18px] top-4 w-3 h-3 rounded-full border-2 border-cosmos-900"
                            style={{ backgroundColor: EVENT_COLORS[event.type] }}
                          />

                          <div
                            className={cn(
                              'p-4 rounded-2xl bg-cosmos-800 border border-white/[0.06] cursor-pointer hover:border-white/[0.1] transition-all',
                              SIGNIFICANCE_STYLES[event.significance],
                              event.significance === 'high' && 'shadow-glow-sm'
                            )}
                            onClick={() => toggleExpand(event.id)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                <div
                                  className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                                  style={{ backgroundColor: `${EVENT_COLORS[event.type]}20`, color: EVENT_COLORS[event.type] }}
                                >
                                  {EVENT_ICONS[event.type]}
                                </div>
                                <div className="min-w-0">
                                  <h3 className="text-sm font-medium text-white truncate">{event.title}</h3>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-2xs text-slate-600">{formatDate(event.timestamp)}</span>
                                    <span className="text-2xs text-slate-700">·</span>
                                    <span
                                      className="text-2xs capitalize"
                                      style={{ color: EVENT_COLORS[event.type] }}
                                    >
                                      {event.type}
                                    </span>
                                    <span className="text-2xs text-slate-700">·</span>
                                    <span className="text-2xs text-slate-600">{event.sourceName}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {event.significance === 'high' && (
                                  <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">high</span>
                                )}
                                <ChevronDown className={cn(
                                  'w-3.5 h-3.5 text-slate-600 transition-transform',
                                  expanded.has(event.id) && 'rotate-180'
                                )} />
                              </div>
                            </div>

                            <AnimatePresence>
                              {expanded.has(event.id) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 pt-3 border-t border-white/[0.06]">
                                    {event.description && (
                                      <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                        {event.description}
                                      </p>
                                    )}
                                    {event.relatedEntities.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">
                                        {event.relatedEntities.map(e => (
                                          <span key={e} className="text-2xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                            {e}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function deriveTimelineFromNodes(nodes: MemoryNode[]): TimelineEvent[] {
  return nodes
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 80)
    .map((node, index) => ({
      id: `derived-${node.id}`,
      nodeId: node.id,
      title: node.title || `Memory ${index + 1}`,
      description: node.summary || node.content.substring(0, 220),
      timestamp: node.timestamp,
      type: inferTimelineType(node),
      sourceId: node.sourceId,
      sourceName: node.sourceName,
      relatedEntities: node.entities.slice(0, 8),
      significance: inferSignificance(node),
    }))
}

function inferTimelineType(node: MemoryNode): TimelineEvent['type'] {
  const text = `${node.title} ${node.summary || ''} ${node.content}`.toLowerCase()
  if (node.type === 'decision' || /\b(decided|decision|choose|chosen|settled)\b/.test(text)) return 'decision'
  if (/\b(switched|pivot|changed|instead|moved from|migrated)\b/.test(text)) return 'pivot'
  if (/\b(reject|dropped|removed|avoid|failed|error)\b/.test(text)) return 'rejection'
  if (/\b(adopt|added|implemented|using|enabled)\b/.test(text)) return 'adoption'
  if (/\b(done|complete|milestone|release|finished)\b/.test(text)) return 'milestone'
  return 'discovery'
}

function inferSignificance(node: MemoryNode): TimelineEvent['significance'] {
  if (node.type === 'decision' || node.entities.length >= 5 || node.content.length > 2500) return 'high'
  if (node.entities.length >= 2 || node.content.length > 900) return 'medium'
  return 'low'
}
