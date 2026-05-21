import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, Brain, Check, Code2, FileText, Folder,
  Github, Lock, MessageSquare, Shield, Sparkles
} from 'lucide-react'
import { useAppStore } from '../../store'
import { cn } from '../../lib/utils'

const STEPS = ['intro', 'sources', 'privacy', 'ready'] as const
type Step = typeof STEPS[number]

const SOURCE_TYPES = [
  { id: 'folder', label: 'Project Folder', icon: Folder, desc: 'Fastest way to test with local files.' },
  { id: 'chatgpt', label: 'ChatGPT Export', icon: MessageSquare, desc: 'Import conversations.json or an extracted export.' },
  { id: 'claude', label: 'Claude Export', icon: MessageSquare, desc: 'Import Claude conversation exports.' },
  { id: 'github', label: 'GitHub Repo', icon: Github, desc: 'Index code, docs, and commit history.' },
  { id: 'notes', label: 'Notes / Markdown', icon: FileText, desc: 'Use Obsidian, markdown notes, or docs.' },
  { id: 'workspace', label: 'Code Workspace', icon: Code2, desc: 'Point to the project you are building.' },
] as const

export default function OnboardingPage(): React.ReactElement {
  const navigate = useNavigate()
  const { setOnboardingComplete, onboardingStep, setOnboardingStep } = useAppStore()
  const [selected, setSelected] = useState<Set<string>>(new Set(['folder']))
  const step = STEPS[Math.min(onboardingStep, STEPS.length - 1)]

  function next() {
    if (onboardingStep < STEPS.length - 1) setOnboardingStep(onboardingStep + 1)
  }

  function back() {
    if (onboardingStep > 0) setOnboardingStep(onboardingStep - 1)
  }

  function finish() {
    localStorage.setItem('cf_onboarding_complete', 'true')
    setOnboardingComplete(true)
    navigate('/sources', { replace: true })
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen w-screen bg-cosmos-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">ContextFabric</div>
              <div className="text-xs text-slate-500">Private AI memory</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {STEPS.map((s, index) => (
              <div
                key={s}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  index === onboardingStep ? 'w-8 bg-indigo-400' : index < onboardingStep ? 'w-4 bg-indigo-500/70' : 'w-4 bg-slate-800'
                )}
              />
            ))}
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <AnimatePresence mode="wait">
            <motion.section
              key={step}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="w-full"
            >
              {step === 'intro' && <IntroStep onNext={next} />}
              {step === 'sources' && <SourcesStep selected={selected} onToggle={toggle} onNext={next} onBack={back} />}
              {step === 'privacy' && <PrivacyStep onNext={next} onBack={back} />}
              {step === 'ready' && <ReadyStep onBack={back} onFinish={finish} />}
            </motion.section>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

function IntroStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-500/15 text-indigo-300">
        <Brain className="h-8 w-8" />
      </div>
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Set up your private AI memory</h1>
      <p className="mt-4 text-base leading-7 text-slate-400">
        Connect a source, sync it locally, then ask questions about your files, chats, code, and decisions.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          ['1', 'Add a source'],
          ['2', 'Sync memory'],
          ['3', 'Ask questions'],
        ].map(([num, label]) => (
          <div key={num} className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-4">
            <div className="mx-auto mb-3 flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-xs font-bold text-indigo-300">{num}</div>
            <div className="text-sm font-medium">{label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
      >
        Get Started
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  )
}

function SourcesStep({
  selected,
  onToggle,
  onNext,
  onBack,
}: {
  selected: Set<string>
  onToggle: (id: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight">What do you want to add first?</h2>
        <p className="mt-3 text-sm text-slate-400">This just helps guide setup. You can add any source later.</p>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        {SOURCE_TYPES.map(source => (
          <button
            key={source.id}
            onClick={() => onToggle(source.id)}
            className={cn(
              'rounded-2xl border p-4 text-left transition',
              selected.has(source.id)
                ? 'border-indigo-400/50 bg-indigo-500/10'
                : 'border-white/[0.08] bg-cosmos-800 hover:border-white/[0.16]'
            )}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                <source.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{source.label}</div>
                  {selected.has(source.id) && <Check className="h-4 w-4 text-indigo-300" />}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{source.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <StepButtons onBack={onBack} onNext={onNext} nextLabel="Continue" />
    </div>
  )
}

function PrivacyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/15 text-emerald-300">
        <Shield className="h-8 w-8" />
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">Your context stays local</h2>
      <p className="mt-4 text-base leading-7 text-slate-400">
        ContextFabric stores your memory on your computer. Apps must request permission before they can read context.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Lock, title: 'Encrypted storage', text: 'Graph data is protected at rest.' },
          { icon: Shield, title: 'Permission flow', text: 'Grant for an hour, session, or always.' },
          { icon: Brain, title: 'Local answers', text: 'Works with local search and local AI.' },
        ].map(item => (
          <div key={item.title} className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-4 text-left">
            <item.icon className="mb-3 h-5 w-5 text-indigo-300" />
            <div className="text-sm font-semibold">{item.title}</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
          </div>
        ))}
      </div>

      <StepButtons onBack={onBack} onNext={onNext} nextLabel="Almost Done" />
    </div>
  )
}

function ReadyStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-500/15 text-indigo-300">
        <Check className="h-8 w-8" />
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">You are ready to add your first source</h2>
      <p className="mt-4 text-base leading-7 text-slate-400">
        The Sources screen will help you add a folder, export, or repo. After syncing, ask a question from the AI page.
      </p>

      <div className="mt-8 rounded-2xl border border-indigo-400/20 bg-indigo-500/10 p-5 text-left">
        <div className="text-sm font-semibold text-indigo-200">Best first test</div>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Add this project folder, click Sync, then ask: "What is this project about?"
        </p>
      </div>

      <div className="mt-8 flex justify-center gap-3">
        <button onClick={onBack} className="rounded-xl border border-white/[0.1] px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05]">
          Back
        </button>
        <button
          onClick={onFinish}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Open Sources
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function StepButtons({ onBack, onNext, nextLabel }: { onBack: () => void; onNext: () => void; nextLabel: string }) {
  return (
    <div className="mt-8 flex justify-center gap-3">
      <button onClick={onBack} className="rounded-xl border border-white/[0.1] px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05]">
        Back
      </button>
      <button
        onClick={onNext}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
      >
        {nextLabel}
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  )
}
