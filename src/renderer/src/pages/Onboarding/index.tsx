import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, ArrowRight, Check, MessageSquare, FileText,
  Code2, Folder, Github, Brain, Zap, Shield, ChevronRight,
  Globe, BookOpen
} from 'lucide-react'
import { useAppStore } from '../../store'
import { cn } from '../../lib/utils'

const STEPS = ['welcome', 'concept', 'sources', 'ai', 'ready'] as const
type Step = typeof STEPS[number]

const SOURCE_TYPES = [
  { id: 'claude', label: 'Claude Exports', icon: MessageSquare, color: '#6366F1', desc: 'Your Claude.ai conversations' },
  { id: 'chatgpt', label: 'ChatGPT Exports', icon: MessageSquare, color: '#10A37F', desc: 'OpenAI conversation history' },
  { id: 'local', label: 'Local Folders', icon: Folder, color: '#F59E0B', desc: 'Notes, documents, projects' },
  { id: 'github', label: 'GitHub Repos', icon: Github, color: '#6E40C9', desc: 'Code and commit history' },
  { id: 'markdown', label: 'Markdown Notes', icon: FileText, color: '#06B6D4', desc: 'Obsidian, Notion exports' },
  { id: 'code', label: 'VSCode Workspace', icon: Code2, color: '#007ACC', desc: 'Active project context' },
] as const

const FEATURES = [
  { icon: Brain, title: 'Semantic Memory', desc: 'AI builds understanding across all your sources, not just keyword search' },
  { icon: Zap, title: 'Instant Recall', desc: 'Ask anything. Get answers with exact source citations in seconds' },
  { icon: Shield, title: 'Fully Local', desc: 'Your data never leaves your machine. Gemma runs on your hardware' },
  { icon: Globe, title: 'Context API', desc: 'Any AI tool can query your memory via local API on port 47821' },
]

export default function OnboardingPage(): React.ReactElement {
  const navigate = useNavigate()
  const { setOnboardingComplete, onboardingStep, setOnboardingStep } = useAppStore()
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())

  const currentStep = STEPS[onboardingStep]

  function handleNext() {
    if (onboardingStep < STEPS.length - 1) {
      setOnboardingStep(onboardingStep + 1)
    }
  }

  function handleComplete() {
    localStorage.setItem('cf_onboarding_complete', 'true')
    setOnboardingComplete(true)
    navigate('/', { replace: true })
  }

  function toggleSource(id: string) {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-cosmos-950 flex flex-col items-center justify-center">
      {/* Ambient background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{ x: [0, 50, -30, 0], y: [0, -80, 60, 0], scale: [1, 1.1, 0.9, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full bg-indigo-600/8 blur-[120px]"
        />
        <motion.div
          animate={{ x: [0, -60, 40, 0], y: [0, 70, -50, 0], scale: [1, 0.9, 1.1, 1] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-violet-600/8 blur-[120px]"
        />
        <motion.div
          animate={{ x: [0, 40, -20, 0], y: [0, -40, 30, 0] }}
          transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut', delay: 6 }}
          className="absolute top-1/2 left-1/2 w-[400px] h-[400px] rounded-full bg-cyan-600/5 blur-[100px]"
        />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Step indicators */}
      <div className="absolute top-8 flex items-center gap-2">
        {STEPS.map((step, i) => (
          <motion.div
            key={step}
            animate={{
              width: i === onboardingStep ? 24 : 6,
              opacity: i <= onboardingStep ? 1 : 0.3,
            }}
            transition={{ duration: 0.3 }}
            className={cn(
              'h-1.5 rounded-full transition-colors',
              i <= onboardingStep ? 'bg-indigo-500' : 'bg-slate-700'
            )}
          />
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.97 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          className="relative z-10 w-full max-w-2xl px-6"
        >
          {currentStep === 'welcome' && <WelcomeStep onNext={handleNext} />}
          {currentStep === 'concept' && <ConceptStep onNext={handleNext} />}
          {currentStep === 'sources' && (
            <SourcesStep
              selected={selectedSources}
              onToggle={toggleSource}
              onNext={handleNext}
            />
          )}
          {currentStep === 'ai' && <AIStep onNext={handleNext} />}
          {currentStep === 'ready' && <ReadyStep onComplete={handleComplete} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setTimeout(() => setVisible(true), 100)
  }, [])

  return (
    <div className="text-center">
      {/* Logo */}
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
        className="mx-auto mb-8 w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 flex items-center justify-center shadow-glow-lg"
      >
        <Sparkles className="w-10 h-10 text-white" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h1 className="text-5xl font-bold tracking-tight mb-4">
          <span className="gradient-text">ContextFabric</span>
        </h1>
        <p className="text-xl text-slate-400 mb-2">One Memory Across Every AI Tool</p>
        <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
          Your personal AI context layer. All your conversations, code, notes, and decisions —
          unified into searchable intelligence that belongs to you.
        </p>
      </motion.div>

      {/* Floating particles */}
      {visible && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 0.6, 0],
                scale: [0, 1, 0],
                x: Math.cos(i / 12 * Math.PI * 2) * 200,
                y: Math.sin(i / 12 * Math.PI * 2) * 200,
              }}
              transition={{ duration: 3, delay: i * 0.1, repeat: Infinity, repeatDelay: 2 }}
              className="absolute left-1/2 top-1/2 w-1 h-1 rounded-full bg-indigo-400"
            />
          ))}
        </div>
      )}

      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        onClick={onNext}
        className="mt-10 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all duration-200 shadow-glow group"
      >
        Get Started
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </motion.button>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9 }}
        className="mt-4 text-xs text-slate-600"
      >
        100% local · No cloud · Your data stays yours
      </motion.p>
    </div>
  )
}

function ConceptStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-4">
          <Brain className="w-3 h-3" />
          How it works
        </div>
        <h2 className="text-3xl font-bold text-white mb-3">Your AI context belongs to you</h2>
        <p className="text-slate-400 leading-relaxed max-w-lg mx-auto">
          Modern AI already has memory. The problem is it's fragmented across every tool.
          ContextFabric gives you one unified layer.
        </p>
      </motion.div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * i }}
            className="p-4 rounded-2xl bg-cosmos-800 border border-white/[0.06] hover:border-indigo-500/20 transition-all"
          >
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center mb-3">
              <f.icon className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="font-medium text-white text-sm mb-1">{f.title}</div>
            <div className="text-xs text-slate-500 leading-relaxed">{f.desc}</div>
          </motion.div>
        ))}
      </div>

      <div className="flex justify-center">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all duration-200 shadow-glow group"
        >
          Connect Your Sources
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  )
}

function SourcesStep({
  selected, onToggle, onNext
}: {
  selected: Set<string>
  onToggle: (id: string) => void
  onNext: () => void
}) {
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium mb-4">
          <Folder className="w-3 h-3" />
          Data Sources
        </div>
        <h2 className="text-3xl font-bold text-white mb-2">What do you want to remember?</h2>
        <p className="text-slate-400 text-sm">Select sources to connect. You can add more later.</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-2.5 mb-6">
        {SOURCE_TYPES.map((src, i) => (
          <motion.button
            key={src.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 * i }}
            onClick={() => onToggle(src.id)}
            className={cn(
              'p-3.5 rounded-2xl border text-left transition-all duration-200',
              selected.has(src.id)
                ? 'border-indigo-500/40 bg-indigo-500/10'
                : 'border-white/[0.06] bg-cosmos-800 hover:border-white/[0.12]'
            )}
          >
            <div className="flex items-start justify-between mb-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${src.color}20` }}
              >
                <src.icon className="w-4 h-4" style={{ color: src.color }} />
              </div>
              {selected.has(src.id) && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center"
                >
                  <Check className="w-3 h-3 text-white" />
                </motion.div>
              )}
            </div>
            <div className="text-sm font-medium text-white">{src.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{src.desc}</div>
          </motion.button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {selected.size > 0
            ? `${selected.size} source${selected.size > 1 ? 's' : ''} selected — connect in Sources tab after setup`
            : 'Skip for now and connect later'}
        </p>
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all duration-200 shadow-glow group"
        >
          Continue
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  )
}

function AIStep({ onNext }: { onNext: () => void }) {
  const [checking, setChecking] = useState(true)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const status = await window.api.ollama.status() as { connected: boolean }
        setConnected(status.connected)
      } catch {
        setConnected(false)
      }
      setChecking(false)
    }, 800)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-4">
          <Zap className="w-3 h-3" />
          Local AI
        </div>
        <h2 className="text-3xl font-bold text-white mb-2">Powered by local Gemma</h2>
        <p className="text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
          ContextFabric uses Ollama to run Gemma locally. Your reasoning stays on your machine.
        </p>
      </motion.div>

      {/* Ollama status */}
      <div className="mb-6 p-5 rounded-2xl bg-cosmos-800 border border-white/[0.06]">
        <div className="flex items-center gap-3 mb-4">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            checking ? 'bg-amber-500/15' : connected ? 'bg-emerald-500/15' : 'bg-red-500/15'
          )}>
            {checking ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full"
              />
            ) : connected ? (
              <Check className="w-5 h-5 text-emerald-400" />
            ) : (
              <Zap className="w-5 h-5 text-red-400" />
            )}
          </div>
          <div>
            <div className="font-semibold text-white">
              {checking ? 'Checking Ollama...' : connected ? 'Ollama Connected' : 'Ollama Not Found'}
            </div>
            <div className="text-xs text-slate-500">
              {checking ? 'Detecting local Ollama installation' :
               connected ? 'Ready for Gemma 3 inference' :
               'Install Ollama to enable local AI'}
            </div>
          </div>
        </div>

        {!checking && !connected && (
          <div className="rounded-xl bg-cosmos-700/50 p-3 text-xs text-slate-400 font-mono space-y-1">
            <p className="text-slate-300 font-semibold not-italic mb-2">Quick setup:</p>
            <p>1. Install Ollama from <span className="text-indigo-400">ollama.ai</span></p>
            <p>2. Run: <span className="text-cyan-400">ollama pull gemma4:e4b</span></p>
            <p>3. Run: <span className="text-cyan-400">ollama pull nomic-embed-text</span></p>
            <p className="text-slate-500 mt-2">ContextFabric works without Ollama (keyword search only)</p>
          </div>
        )}
      </div>

      {/* Privacy note */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/15 mb-6">
        <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-emerald-300 mb-1">100% Private by Design</div>
          <p className="text-xs text-slate-500 leading-relaxed">
            All AI processing happens locally. No data is ever sent to cloud services.
            Your context is stored in SQLite on your machine only.
          </p>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all duration-200 shadow-glow group"
        >
          Almost There
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  )
}

function ReadyStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="mx-auto mb-6 w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-glow-cyan"
      >
        <Check className="w-10 h-10 text-white" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="text-4xl font-bold text-white mb-3">You're ready</h2>
        <p className="text-slate-400 text-lg mb-8 max-w-md mx-auto leading-relaxed">
          ContextFabric is set up. Connect your first data source to start building your unified AI memory.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="grid grid-cols-3 gap-3 mb-8 max-w-lg mx-auto"
      >
        {[
          { step: '1', label: 'Add a source', sub: 'Connect Claude exports or local files' },
          { step: '2', label: 'Index & embed', sub: 'Gemma processes your knowledge' },
          { step: '3', label: 'Ask anything', sub: 'Natural language over all your data' },
        ].map((item, i) => (
          <motion.div
            key={item.step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.1 }}
            className="p-3 rounded-xl bg-cosmos-800 border border-white/[0.06]"
          >
            <div className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center mb-2 mx-auto">
              {item.step}
            </div>
            <div className="text-xs font-semibold text-white">{item.label}</div>
            <div className="text-2xs text-slate-500 mt-1">{item.sub}</div>
          </motion.div>
        ))}
      </motion.div>

      <motion.button
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7 }}
        onClick={onComplete}
        className="inline-flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold px-10 py-4 rounded-2xl transition-all duration-200 shadow-glow-lg text-lg group"
      >
        <Sparkles className="w-5 h-5" />
        Enter ContextFabric
        <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
      </motion.button>
    </div>
  )
}
