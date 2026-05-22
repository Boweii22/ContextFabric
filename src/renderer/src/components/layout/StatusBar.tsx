import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cpu, Activity, Circle } from 'lucide-react'
import { useAppStore } from '../../store'
import { cn } from '../../lib/utils'

export default function StatusBar(): React.ReactElement {
  const { ollamaConnected, processingStatuses, stats } = useAppStore()
  const processingList = Object.values(processingStatuses)
  const isProcessing = processingList.length > 0

  return (
    <div className="h-7 flex items-center gap-4 px-4 bg-cosmos-950/50 border-t border-white/[0.04] shrink-0">
      {/* Ollama status */}
      <div className="flex items-center gap-1.5">
        <div className={cn(
          'w-1.5 h-1.5 rounded-full',
          ollamaConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
        )} />
        <span className="text-2xs text-slate-500">
          {ollamaConnected ? 'Gemma Connected' : 'Ollama Offline'}
        </span>
      </div>

      <div className="w-px h-3 bg-white/[0.08]" />

      {/* Processing status */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex items-center gap-1.5"
          >
            <Activity className="w-3 h-3 text-indigo-400 animate-pulse" />
            <span className="text-2xs text-indigo-400">
              {processingList[0]?.message || 'Processing...'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1" />

      {/* Stats */}
      {stats && (
        <div className="flex items-center gap-3">
          <StatusItem icon={<Circle className="w-2.5 h-2.5 fill-current" />} value={`${stats.totalNodes.toLocaleString()} nodes`} />
          <StatusItem icon={<Cpu className="w-2.5 h-2.5" />} value="Local" />
          <span className="text-2xs text-slate-600">by Bowei Tombri</span>
          <span className="text-2xs text-slate-600">v1.0.0</span>
        </div>
      )}
    </div>
  )
}

function StatusItem({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-1 text-slate-600">
      {icon}
      <span className="text-2xs">{value}</span>
    </div>
  )
}
