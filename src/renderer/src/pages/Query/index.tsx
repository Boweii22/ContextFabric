import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, Brain, Sparkles, Clock, ChevronRight, ExternalLink,
  Copy, ThumbsUp, RotateCcw, Zap, AlertCircle, Search,
  BookOpen, GitBranch
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { formatDate, truncate, getTypeColor } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { AIQueryResult, SearchResult } from '../../../../shared/types'

const EXAMPLE_QUERIES = [
  { text: "Why did I reject Supabase?", category: "Architecture" },
  { text: "What's my auth system history?", category: "Auth" },
  { text: "Summarize all Redis discussions", category: "Database" },
  { text: "What changed in my frontend stack?", category: "Frontend" },
  { text: "Show unresolved technical debt", category: "Issues" },
  { text: "What was my reasoning for microservices?", category: "Architecture" },
  { text: "How has my TypeScript usage evolved?", category: "Code" },
  { text: "What testing strategies did I consider?", category: "Testing" },
]

export default function QueryPage(): React.ReactElement {
  const { queryResult, setQueryResult, isQuerying, setIsQuerying, queryHistory, addToHistory, ollamaConnected } = useAppStore()
  const [input, setInput] = useState('')
  const [activeSource, setActiveSource] = useState<SearchResult | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleQuery(q?: string) {
    const query = q || input.trim()
    if (!query || isQuerying) return

    setInput('')
    setIsQuerying(true)
    setQueryResult(null)
    setActiveSource(null)

    try {
      const result = await api.memory.query(query) as AIQueryResult
      setQueryResult(result)
      addToHistory(result)
    } catch (err) {
      setQueryResult({
        query,
        answer: `Error: ${err instanceof Error ? err.message : 'Query failed. Make sure Ollama is running.'}`,
        reasoning: '',
        sources: [],
        entities: [],
        confidence: 0,
        processingTime: 0,
      })
    } finally {
      setIsQuerying(false)
    }
  }

  function copyAnswer() {
    if (queryResult?.answer) {
      navigator.clipboard.writeText(queryResult.answer)
    }
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Main query area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.06] bg-cosmos-950/20 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center">
            <Brain className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">AI Memory Query</h1>
            <p className="text-xs text-slate-500">Reason across your entire knowledge base</p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border',
              ollamaConnected
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            )}>
              <div className={cn(
                'w-1.5 h-1.5 rounded-full',
                ollamaConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              )} />
              {ollamaConnected ? 'Gemma Active' : 'Keyword Mode'}
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto scrollbar-none px-6 py-6" ref={resultsRef}>
          {/* Example queries (shown when no result) */}
          <AnimatePresence mode="wait">
            {!queryResult && !isQuerying && (
              <motion.div
                key="examples"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Ask your memory anything</h2>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">
                    Gemma reasons across all your connected sources to reconstruct decisions, timelines, and context.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 max-w-2xl mx-auto">
                  {EXAMPLE_QUERIES.map((q, i) => (
                    <motion.button
                      key={q.text}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => handleQuery(q.text)}
                      className="flex items-center gap-3 p-3.5 rounded-xl bg-cosmos-800 border border-white/[0.06] hover:border-indigo-500/25 hover:bg-indigo-500/5 transition-all text-left group"
                    >
                      <div className="text-left flex-1">
                        <div className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">
                          "{q.text}"
                        </div>
                        <div className="text-2xs text-slate-600 mt-0.5">{q.category}</div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400 transition-colors shrink-0" />
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {isQuerying && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20"
              >
                {/* Animated orbs */}
                <div className="relative w-24 h-24 mb-6">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="absolute inset-0 rounded-full border border-indigo-500/40"
                      animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2, delay: i * 0.6, repeat: Infinity }}
                    />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent"
                    />
                  </div>
                </div>
                <p className="text-sm text-slate-400 mb-1">Reasoning across your memory...</p>
                <p className="text-xs text-slate-600">Gemma is analyzing your knowledge base</p>
              </motion.div>
            )}

            {queryResult && !isQuerying && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-3xl mx-auto"
              >
                {/* Query echo */}
                <div className="flex justify-end mb-4">
                  <div className="max-w-lg px-4 py-3 rounded-2xl rounded-br-sm bg-indigo-600/20 border border-indigo-500/20 text-sm text-slate-200">
                    {queryResult.query}
                  </div>
                </div>

                {/* Answer */}
                <div className="mb-6">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-glow-sm">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-indigo-400">ContextFabric AI</span>
                        <span className="text-2xs text-slate-600">
                          {queryResult.processingTime > 0 && `${(queryResult.processingTime / 1000).toFixed(1)}s`}
                        </span>
                        <span className={cn(
                          'text-2xs px-2 py-0.5 rounded-full',
                          queryResult.confidence > 70 ? 'bg-emerald-500/10 text-emerald-400' :
                          queryResult.confidence > 40 ? 'bg-amber-500/10 text-amber-400' :
                          'bg-red-500/10 text-red-400'
                        )}>
                          {queryResult.confidence.toFixed(0)}% confidence
                        </span>
                      </div>

                      <div className="p-4 rounded-2xl bg-cosmos-800 border border-white/[0.06]">
                        <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {queryResult.answer}
                        </p>
                      </div>

                      {/* Reasoning */}
                      {queryResult.reasoning && (
                        <div className="mt-2 px-4 py-2.5 rounded-xl bg-cosmos-700/40 border border-white/[0.04]">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Zap className="w-3 h-3 text-slate-600" />
                            <span className="text-2xs text-slate-600 font-medium uppercase tracking-wide">Reasoning</span>
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{queryResult.reasoning}</p>
                        </div>
                      )}

                      {/* Entities */}
                      {queryResult.entities.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-2xs text-slate-600">Entities:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {queryResult.entities.map(e => (
                              <span key={e} className="text-2xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                {e}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={copyAnswer}
                          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] transition-all"
                        >
                          <Copy className="w-3 h-3" />
                          Copy
                        </button>
                        <button
                          onClick={() => { setQueryResult(null); setInput(queryResult.query) }}
                          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] transition-all"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Retry
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sources */}
                {queryResult.sources.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="w-4 h-4 text-slate-500" />
                      <h3 className="text-sm font-semibold text-white">
                        Sources ({queryResult.sources.length})
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {queryResult.sources.map((result, i) => (
                        <motion.div
                          key={result.node.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          onClick={() => setActiveSource(activeSource?.node.id === result.node.id ? null : result)}
                          className={cn(
                            'p-3.5 rounded-xl border cursor-pointer transition-all',
                            activeSource?.node.id === result.node.id
                              ? 'border-indigo-500/30 bg-indigo-500/5'
                              : 'border-white/[0.06] bg-cosmos-800 hover:border-white/[0.12]'
                          )}
                        >
                          <div className="flex items-center gap-2.5 mb-2">
                            <span className="text-2xs font-bold text-slate-600">#{i + 1}</span>
                            <div
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: getTypeColor(result.node.type) }}
                            />
                            <span className="text-xs font-medium text-slate-300 flex-1 truncate">
                              {result.node.title}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-2xs text-slate-600">{result.sourceContext}</span>
                              <div className="text-2xs px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400">
                                {(result.score * 100).toFixed(0)}%
                              </div>
                            </div>
                          </div>

                          {/* Highlights */}
                          {result.highlights.slice(0, 1).map((h, hi) => (
                            <p key={hi} className="text-xs text-slate-500 leading-relaxed truncate">
                              {h}
                            </p>
                          ))}

                          {/* Expanded content */}
                          <AnimatePresence>
                            {activeSource?.node.id === result.node.id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                                  <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                                    {truncate(result.node.content, 800)}
                                  </p>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input area */}
        <div className="border-t border-white/[0.06] bg-cosmos-950/30 px-6 py-4 shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="relative gradient-border rounded-2xl overflow-hidden">
              <div className="bg-cosmos-800 rounded-2xl">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleQuery()
                    }
                  }}
                  placeholder="Ask anything about your knowledge... (Enter to send, Shift+Enter for newline)"
                  rows={2}
                  className="w-full bg-transparent text-white placeholder-slate-600 px-4 pt-3.5 pb-12 text-sm focus:outline-none resize-none"
                  disabled={isQuerying}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                  <span className="text-2xs text-slate-600">⏎ Send</span>
                  <button
                    onClick={() => handleQuery()}
                    disabled={!input.trim() || isQuerying}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-1.5 rounded-xl transition-all"
                  >
                    {isQuerying ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-3 h-3 border-2 border-white border-t-transparent rounded-full"
                      />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    Query
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History sidebar */}
      {queryHistory.length > 0 && (
        <div className="w-64 border-l border-white/[0.06] bg-cosmos-950/20 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <h2 className="text-xs font-semibold text-white">History</h2>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-none py-2">
            {queryHistory.map((h, i) => (
              <button
                key={i}
                onClick={() => { setQueryResult(h); setActiveSource(null) }}
                className={cn(
                  'w-full text-left px-4 py-3 hover:bg-white/[0.03] border-b border-white/[0.03] transition-colors',
                  queryResult?.query === h.query && 'bg-indigo-500/5'
                )}
              >
                <div className="text-xs text-slate-400 truncate mb-1">"{h.query}"</div>
                <div className="text-2xs text-slate-600">{h.sources.length} sources</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
