import React from 'react'
import { Minus, Square, X } from 'lucide-react'
import { api } from '../../lib/api'

export default function TitleBar(): React.ReactElement {
  return (
    <div
      className="h-10 flex items-center justify-between px-4 bg-cosmos-950/50 border-b border-white/[0.04] shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex-1" />

      {/* Window controls - Windows style */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => api.window.minimize()}
          className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/[0.08] rounded-md transition-all"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => api.window.maximize()}
          className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/[0.08] rounded-md transition-all"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => api.window.close()}
          className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-white hover:bg-red-500/80 rounded-md transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
