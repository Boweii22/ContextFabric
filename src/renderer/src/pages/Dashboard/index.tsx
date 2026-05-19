import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, ArrowRight, Clock, GitBranch, MessageSquare,
  TrendingUp, Zap, Database, Brain, ChevronRight, Search,
  Activity, Circle
} from 'lucide-react'
import { useAppStore } from '../../store'
import { api } from '../../lib/api'
import { formatDate, truncate, getTypeColor } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { SearchResult } from '../../../../shared/types'

const QUICK_QUERIES = [
  "What architecture decisions did I make recently?",
  "Why did I reject a previous database choice?",
  "Summarize my auth system discussions",
  "Show all Redis-related context",
  "What unresolved problems do I have?",
]

export default function DashboardPage(): React.ReactElement {
  const navigate = useNavigate()
  const { stats, sources, timeline, queryResult, setQueryResult, setIsQuerying, isQuerying, addToHistory } = useAppStore()
  const [quickQuery, setQuickQuery] = useState('')
  const [recentNodes, setRecentNodes] = useState<SearchResult[]>([])

  useEffect(() => {
    loadRecentNodes()
  }, [])

  async function loadRecentNodes() {
    try {
      const results = await api.memory.search('', 8) as SearchResult[]
      setRecentNodes(results)
    } catch {
      // ignore
    }
  }

  async function handleQuery(q: string) {
    if (!q.trim()) return
    setIsQuerying(true)
    setQueryResult(null)
    navigate('/query')

    try {
      const result = await api.memory.query(q) as Parameters<typeof setQueryResult>[0]
      setQueryResult(result)
      if (result) addToHistory(result)
    } finally {
      setIsQuerying(false)
    }
  }

  const readySources = sources.filter(s => s.status === 'ready')
  const totalNodes = stats?.totalNodes || 0

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-label">ContextFabric</span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {totalNodes === 0 ? 'Welcome to your memory' : 'Your unified context'}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {totalNodes === 0
              ? 'Connect your first source to start building'
              : `${totalNodes.toLocaleString()} memory nodes across ${readySources.length} sources`}
          </p>
        </motion.div>

        {/* Query box */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <div className="relative gradient-border rounded-2xl overflow-hidden">
            <div className="relative bg-cosmos-800 rounded-2xl">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={quickQuery}
                onChange={e => setQuickQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleQuery(quickQuery)}
                placeholder="Ask anything about your memory... (e.g., 'Why did I stop using Firebase?')"
                className="w-full bg-transparent text-white placeholder-slate-600 pl-11 pr-32 py-4 text-sm focus:outline-none"
                disabled={isQuerying}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {isQuerying ? (
                  <div className="flex items-center gap-2 text-indigo-400 text-xs">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full"
                    />
                    Reasoning...
                  </div>
                ) : (
                  <button
                    onClick={() => handleQuery(quickQuery)}
                    disabled={!quickQuery.trim()}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                  >
                    <Brain className="w-3 h-3" />
                    Query AI
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick queries */}
          <div className="flex gap-2 mt-2 overflow-x-auto scrollbar-none pb-1">
            {QUICK_QUERIES.map(q => (
              <button
                key={q}
                onClick={() => handleQuery(q)}
                className="shrink-0 text-xs text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 border border-white/[0.05] hover:border-indigo-500/20 px-3 py-1.5 rounded-full transition-all whitespace-nowrap"
              >
                {q}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Stats grid */}
        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="grid grid-cols-4 gap-3 mb-6"
          >
            <StatCard
              label="Memory Nodes"
              value={stats.totalNodes.toLocaleString()}
              icon={<Circle className="w-4 h-4 fill-indigo-400 text-indigo-400" />}
              color="indigo"
              onClick={() => navigate('/graph')}
            />
            <StatCard
              label="Data Sources"
              value={stats.totalSources.toLocaleString()}
              icon={<Database className="w-4 h-4 text-violet-400" />}
              color="violet"
              onClick={() => navigate('/sources')}
            />
            <StatCard
              label="Entities"
              value={stats.totalEntities.toLocaleString()}
              icon={<GitBranch className="w-4 h-4 text-cyan-400" />}
              color="cyan"
              onClick={() => navigate('/graph')}
            />
            <StatCard
              label="AI Status"
              value={stats.ollamaConnected ? 'Connected' : 'Offline'}
              icon={<Activity className={cn('w-4 h-4', stats.ollamaConnected ? 'text-emerald-400' : 'text-amber-400')} />}
              color={stats.ollamaConnected ? 'emerald' : 'amber'}
              onClick={() => navigate('/settings')}
            />
          </motion.div>
        )}

        {/* Empty state */}
        {totalNodes === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-6 p-8 rounded-3xl bg-gradient-to-br from-indigo-500/5 to-violet-500/5 border border-indigo-500/15 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Start Building Your Memory</h3>
            <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
              Connect Claude exports, local folders, or GitHub repos to create your unified AI context layer.
            </p>
            <button
              onClick={() => navigate('/sources')}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-xl transition-all shadow-glow"
            >
              <Database className="w-4 h-4" />
              Connect First Source
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {/* Recent memory */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="col-span-2 surface-card p-4"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-white">Recent Memory</h2>
              </div>
              <button
                onClick={() => navigate('/graph')}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                View graph <ChevronRight className="w-3 h-3" />
              </button>
            </div>

            {recentNodes.length === 0 ? (
              <div className="py-8 text-center text-slate-600 text-sm">
                No memory nodes yet. Connect a source to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {recentNodes.slice(0, 6).map((result, i) => (
                  <motion.div
                    key={result.node.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.05 }}
                    className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-colors cursor-pointer group"
                  >
                    <div
                      className="w-2 h-2 rounded-full mt-2 shrink-0"
                      style={{ backgroundColor: getTypeColor(result.node.type) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200 truncate">
                        {result.node.title}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        {truncate(result.node.content.replace(/\n/g, ' '), 80)}
                      </div>
                    </div>
                    <div className="text-2xs text-slate-600 shrink-0">
                      {formatDate(result.node.timestamp)}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Timeline + Quick actions */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-3"
          >
            {/* Recent decisions */}
            <div className="surface-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-white">Key Decisions</h2>
              </div>
              {timeline.slice(0, 4).map((event, i) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 + i * 0.05 }}
                  className="flex items-start gap-2 py-2 border-b border-white/[0.04] last:border-0 cursor-pointer hover:bg-white/[0.02] rounded-lg px-1 transition-colors"
                  onClick={() => navigate('/timeline')}
                >
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0',
                    event.significance === 'high' ? 'bg-amber-400' :
                    event.significance === 'medium' ? 'bg-indigo-400' : 'bg-slate-600'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-300 truncate">{event.title}</div>
                    <div className="text-2xs text-slate-600">{formatDate(event.timestamp)}</div>
                  </div>
                </motion.div>
              ))}
              {timeline.length === 0 && (
                <div className="py-4 text-center text-xs text-slate-600">
                  Decisions will appear after indexing
                </div>
              )}
            </div>

            {/* Quick navigation */}
            <div className="surface-card p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Quick Access</h2>
              <div className="space-y-1.5">
                {[
                  { label: 'Memory Graph', icon: GitBranch, path: '/graph', color: 'text-indigo-400' },
                  { label: 'AI Query', icon: MessageSquare, path: '/query', color: 'text-violet-400' },
                  { label: 'Timeline', icon: Clock, path: '/timeline', color: 'text-cyan-400' },
                  { label: 'Add Source', icon: Database, path: '/sources', color: 'text-emerald-400' },
                ].map(item => (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/[0.04] transition-colors text-left group"
                  >
                    <item.icon className={cn('w-3.5 h-3.5', item.color)} />
                    <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
                      {item.label}
                    </span>
                    <ChevronRight className="w-3 h-3 text-slate-700 ml-auto group-hover:text-slate-500 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label, value, icon, color, onClick
}: {
  label: string
  value: string
  icon: React.ReactNode
  color: string
  onClick?: () => void
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="surface-card surface-card-hover p-4 text-left w-full"
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg bg-${color}-500/10`}>{icon}</div>
        <TrendingUp className="w-3 h-3 text-slate-700" />
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </motion.button>
  )
}
