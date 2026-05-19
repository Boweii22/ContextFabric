import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, Brain, Sparkles, Clock, ChevronRight,
  Copy, RotateCcw, Zap, BookOpen, Check
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { formatDate, truncate, getTypeColor } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { AIQueryResult, SearchResult } from '../../../../shared/types'

const EXAMPLE_QUERIES = [
  { text: "What stack did I use in my recent project?", category: "Stack" },
  { text: "Why did I reject Supabase?", category: "Architecture" },
  { text: "What's my auth system history?", category: "Auth" },
  { text: "Summarize all Redis discussions", category: "Database" },
  { text: "Show unresolved technical debt", category: "Issues" },
  { text: "What changed in my frontend stack?", category: "Frontend" },
  { text: "What was my reasoning for microservices?", category: "Architecture" },
  { text: "What testing strategies did I consider?", category: "Testing" },
]

export default function QueryPage(): React.ReactElement {
  const {
    queryResult, setQueryResult,
    isQuerying, setIsQuerying,
    queryHistory, addToHistory,
    ollamaConnected
  } = useAppStore()

  const [input, setInput] = useState('')
  const [pendingQuery, setPendingQuery] = useState<string | null>(null)
  const [activeSource, setActiveSource] = useState<SearchResult | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleQuery(q?: string) {
    const query = (q || input).trim()
    if (!query || isQuerying) return

    setInput('')
    setIsQuerying(true)
    setQueryResult(null)
    setActiveSource(null)
    setPendingQuery(query)   // show echo immediately, before IPC returns

    try {
      const result = await api.memory.query(query) as AIQueryResult
      setQueryResult(result)
      addToHistory(result)
    } catch (err) {
      setQueryResult({
        query,
        answer: `Error: ${err instanceof Error ? err.message : 'Query failed. Make sure Ollama is running with: ollama serve'}`,
        reasoning: '',
        sources: [],
        entities: [],
        confidence: 0,
        processingTime: 0,
      })
    } finally {
      setIsQuerying(false)
      setPendingQuery(null)
    }
  }

  function copyAnswer() {
    const text = queryResult?.answer
    if (!text) return
    const fallback = () => {
      const el = document.createElement('textarea')
      el.value = text
      el.style.cssText = 'position:fixed;opacity:0;'
      document.body.appendChild(el)
      el.focus(); el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback)
    } else {
      fallback()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const showExamples = !queryResult && !isQuerying && !pendingQuery

  return (
    <div className="h-full flex overflow-hidden">
      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-3.5 border-b border-white/[0.06] shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">AI Memory Query</h1>
            <p className="text-xs text-slate-500">Reason across your entire knowledge base</p>
          </div>
          <div className="ml-auto">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border',
              ollamaConnected
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            )}>
              <div className={cn('w-1.5 h-1.5 rounded-full', ollamaConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400')} />
              {ollamaConnected ? 'Gemma Connected' : 'Ollama Offline'}
            </div>
          </div>
        </div>

        {/* Scroll area */}
        <div className="flex-1 overflow-y-auto scrollbar-none px-6 py-6">
          <div className="max-w-3xl mx-auto space-y-6">

            {/* Example prompts */}
            <AnimatePresence>
              {showExamples && (
                <motion.div
                  key="examples"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="text-center mb-8">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center mx-auto mb-3">
                      <Sparkles className="w-7 h-7 text-indigo-400" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-1">Ask your memory anything</h2>
                    <p className="text-slate-500 text-sm">Gemma reasons across all your sources to reconstruct decisions and context.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {EXAMPLE_QUERIES.map((q, i) => (
                      <motion.button
                        key={q.text}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={() => handleQuery(q.text)}
                        className="flex items-center gap-3 p-3.5 rounded-xl bg-cosmos-800 border border-white/[0.06] hover:border-indigo-500/25 hover:bg-indigo-500/5 transition-all text-left group"
                      >
                        <div className="flex-1 text-xs font-medium text-slate-300 group-hover:text-white transition-colors">
                          "{q.text}"
                        </div>
                        <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-indigo-400 transition-colors shrink-0" />
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pending query echo — shown immediately on submit */}
            <AnimatePresence>
              {(pendingQuery || (isQuerying && queryResult === null)) && (
                <motion.div
                  key="pending"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* User bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-lg px-4 py-3 rounded-2xl rounded-br-sm bg-indigo-600/25 border border-indigo-500/20 text-sm text-slate-200">
                      {pendingQuery}
                    </div>
                  </div>

                  {/* Loading answer */}
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-glow-sm">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 p-4 rounded-2xl bg-cosmos-800 border border-white/[0.06]">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-medium text-indigo-400">ContextFabric AI</span>
                        <span className="text-2xs text-slate-600">searching & reasoning...</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {[0, 1, 2].map(i => (
                          <motion.div
                            key={i}
                            className="w-2 h-2 rounded-full bg-indigo-500"
                            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
                            transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Result */}
            <AnimatePresence>
              {queryResult && !isQuerying && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {/* User bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-lg px-4 py-3 rounded-2xl rounded-br-sm bg-indigo-600/25 border border-indigo-500/20 text-sm text-slate-200">
                      {queryResult.query}
                    </div>
                  </div>

                  {/* Answer */}
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-glow-sm">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-indigo-400">ContextFabric AI</span>
                        {queryResult.processingTime > 0 && (
                          <span className="text-2xs text-slate-600">{(queryResult.processingTime / 1000).toFixed(1)}s</span>
                        )}
                        <span className={cn(
                          'text-2xs px-1.5 py-0.5 rounded-full',
                          queryResult.confidence > 70 ? 'bg-emerald-500/10 text-emerald-400' :
                          queryResult.confidence > 40 ? 'bg-amber-500/10 text-amber-400' :
                          'bg-slate-500/10 text-slate-500'
                        )}>
                          {queryResult.confidence.toFixed(0)}% match
                        </span>
                      </div>

                      <div className="p-4 rounded-2xl bg-cosmos-800 border border-white/[0.06] mb-2">
                        <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {queryResult.answer}
                        </p>
                      </div>

                      {/* Reasoning */}
                      {queryResult.reasoning && (
                        <div className="px-3 py-2 rounded-xl bg-cosmos-700/40 border border-white/[0.04] mb-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Zap className="w-3 h-3 text-slate-600" />
                            <span className="text-2xs text-slate-600 uppercase tracking-wide font-medium">Context</span>
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{queryResult.reasoning}</p>
                        </div>
                      )}

                      {/* Entities */}
                      {queryResult.entities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {queryResult.entities.map(e => (
                            <span key={e} className="text-2xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                              {e}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={copyAnswer}
                          className={cn(
                            'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all',
                            copied ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.05]'
                          )}
                        >
                          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copied ? 'Copied!' : 'Copy'}
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

                  {/* Sources */}
                  {queryResult.sources.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-xs font-semibold text-slate-400">
                          Sources ({queryResult.sources.length})
                        </span>
                      </div>
                      <div className="space-y-2">
                        {queryResult.sources.map((result, i) => (
                          <motion.div
                            key={result.node.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04 }}
                            onClick={() => setActiveSource(
                              activeSource?.node.id === result.node.id ? null : result
                            )}
                            className={cn(
                              'p-3.5 rounded-xl border cursor-pointer transition-all',
                              activeSource?.node.id === result.node.id
                                ? 'border-indigo-500/30 bg-indigo-500/5'
                                : 'border-white/[0.06] bg-cosmos-800 hover:border-white/[0.12]'
                            )}
                          >
                            <div className="flex items-center gap-2.5 mb-1.5">
                              <span className="text-2xs font-bold text-slate-600">#{i + 1}</span>
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getTypeColor(result.node.type) }} />
                              <span className="text-xs font-medium text-slate-300 flex-1 truncate">{result.node.title}</span>
                              <span className="text-2xs text-slate-600 shrink-0">{formatDate(result.node.timestamp)}</span>
                              <span className="text-2xs px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 shrink-0">
                                {(result.score * 100).toFixed(0)}%
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                              {result.highlights[0] || truncate(result.node.content, 120)}
                            </p>

                            <AnimatePresence>
                              {activeSource?.node.id === result.node.id && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 pt-3 border-t border-white/[0.06]">
                                    <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap font-mono">
                                      {truncate(result.node.content, 1000)}
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
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.06] px-6 py-4 shrink-0">
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
                  placeholder="Ask anything about your memory… (Enter to send)"
                  rows={2}
                  className="w-full bg-transparent text-white placeholder-slate-600 px-4 pt-3.5 pb-12 text-sm focus:outline-none resize-none"
                  disabled={isQuerying}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                  <span className="text-2xs text-slate-600">⏎ Send · Shift+⏎ newline</span>
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
                    Ask
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History sidebar */}
      {queryHistory.length > 0 && (
        <div className="w-60 border-l border-white/[0.06] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs font-semibold text-white">History</span>
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
                <div className="text-xs text-slate-400 line-clamp-2 mb-1">"{h.query}"</div>
                <div className="text-2xs text-slate-600">{h.sources.length} sources · {(h.processingTime / 1000).toFixed(1)}s</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
