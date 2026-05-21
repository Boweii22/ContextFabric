import React from 'react'
import { motion } from 'framer-motion'
import {
  Bot, CheckCircle2, Database, Download, FolderPlus,
  HelpCircle, KeyRound, Plug, Shield, WifiOff
} from 'lucide-react'

const QUICK_START = [
  {
    icon: FolderPlus,
    title: 'Add real data',
    body: 'Open Sources, add a project folder, ChatGPT export, Claude export, or GitHub repository, then press Sync.',
  },
  {
    icon: Bot,
    title: 'Ask with Gemma',
    body: 'Open AI Query and ask about a project, decision, or preference. ContextFabric retrieves local evidence before Gemma answers.',
  },
  {
    icon: Shield,
    title: 'Approve access',
    body: 'When another app requests context, approve one hour, this session, or always from Permissions.',
  },
  {
    icon: Plug,
    title: 'Use the browser bridge',
    body: 'Package the extension, load it unpacked, then use the CF button on Claude, ChatGPT, Cursor, and other supported AI pages.',
  },
] as const

const TESTS = [
  ['Gemma health', 'Run npm run verify:gemma. It checks Ollama, the embedding model, the Gemma model, and a live response.'],
  ['Offline proof', 'Keep Ollama open, disconnect WiFi, then run npm run verify:gemma again. A pass proves the core local-first claim.'],
  ['Extension packaging', 'Run npm run extension:package, then load the generated browser-extension folder as an unpacked extension.'],
  ['App build', 'Run npm run build before recording or submitting.'],
] as const

const TROUBLESHOOTING = [
  ['Gemma says memory cannot be allocated', 'Close browsers, editors, and other Ollama models. Pull the smaller Gemma 4 E2B model when Ollama allows it: ollama pull gemma4:e2b.'],
  ['ChatGPT export path is too long on Windows', 'Move the zip to C:\\tmp, extract it there, then point ContextFabric at the extracted folder or conversations.json.'],
  ['The extension inserts repeated context', 'Clear the chat box, refresh the AI page, then inject once. The extension now prefers active chat inputs and avoids stale text areas.'],
  ['An app is denied permission', 'Open Permissions, approve the pending request, then retry the app request.'],
] as const

export default function HelpPage(): React.ReactElement {
  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300">
            <HelpCircle className="h-3.5 w-3.5" />
            Production help
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">How to run ContextFabric for real</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            A practical checklist for testing local memory, Gemma 4 answers, permission approvals, imports, sync, and the browser bridge.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {QUICK_START.map(({ icon: Icon, title, body }, index) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
            </motion.div>
          ))}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Testing checklist
            </div>
            <div className="space-y-3">
              {TESTS.map(([title, body]) => (
                <div key={title} className="rounded-xl border border-white/[0.06] bg-cosmos-900/70 p-4">
                  <div className="text-sm font-medium text-slate-100">{title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-400">{body}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Database className="h-4 w-4 text-indigo-300" />
              Useful commands
            </div>
            <Command icon={Bot} text="ollama pull gemma4:e2b" />
            <Command icon={Bot} text="ollama pull nomic-embed-text" />
            <Command icon={KeyRound} text="npm run verify:gemma" />
            <Command icon={Download} text="npm run release:local" />
            <Command icon={WifiOff} text="disconnect WiFi, then npm run verify:gemma" />
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-white/[0.08] bg-cosmos-800 p-5">
          <div className="mb-4 text-sm font-semibold text-white">Troubleshooting</div>
          <div className="grid gap-3 md:grid-cols-2">
            {TROUBLESHOOTING.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-white/[0.06] bg-cosmos-900/70 p-4">
                <div className="text-sm font-medium text-slate-100">{title}</div>
                <div className="mt-1 text-sm leading-6 text-slate-400">{body}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function Command({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-cosmos-900/70 px-3 py-2.5">
      <Icon className="h-4 w-4 text-slate-500" />
      <code className="text-xs text-slate-300">{text}</code>
    </div>
  )
}
