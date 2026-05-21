import React from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, GitBranch, Clock, MessageSquare, Database,
  Settings, Shield, ChevronLeft, ChevronRight, Sparkles,
  Zap, Search, Bell, Sun, Moon, Bot, HelpCircle
} from 'lucide-react'
import { useAppStore } from '../../store'
import { cn } from '../../lib/utils'
import { api } from '../../lib/api'
import TitleBar from './TitleBar'
import StatusBar from './StatusBar'

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', shortcut: '1' },
  { path: '/graph', icon: GitBranch, label: 'Memory Graph', shortcut: '2' },
  { path: '/timeline', icon: Clock, label: 'Timeline', shortcut: '3' },
  { path: '/query', icon: MessageSquare, label: 'AI Query', shortcut: '4' },
  { path: '/sources', icon: Database, label: 'Sources', shortcut: '5' },
  { path: '/gemma', icon: Bot, label: 'Gemma Evidence', shortcut: '6' },
] as const

const BOTTOM_NAV = [
  { path: '/help', icon: HelpCircle, label: 'Help' },
  { path: '/permissions', icon: Shield, label: 'Permissions' },
  { path: '/settings', icon: Settings, label: 'Settings' },
] as const

export default function AppShell(): React.ReactElement {
  const location = useLocation()
  const navigate = useNavigate()
  const { sidebarCollapsed, setSidebarCollapsed, stats, ollamaConnected, isDarkMode, toggleTheme, activeContext } = useAppStore()

  return (
    <div className="flex flex-col h-screen bg-cosmos-900 overflow-hidden">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <motion.aside
          animate={{ width: sidebarCollapsed ? 64 : 220 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="relative flex flex-col h-full bg-cosmos-950/80 border-r border-white/[0.06] shrink-0 overflow-hidden"
        >
          {/* Logo */}
          <div className="flex items-center h-14 px-4 shrink-0">
            <motion.div
              animate={{ opacity: sidebarCollapsed ? 0 : 1, scale: sidebarCollapsed ? 0.8 : 1 }}
              className="flex items-center gap-2.5 overflow-hidden"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-glow-sm">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              {!sidebarCollapsed && (
                <span className="font-semibold text-sm tracking-tight text-white whitespace-nowrap">
                  ContextFabric
                </span>
              )}
            </motion.div>
            {sidebarCollapsed && (
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-glow-sm">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
            )}
          </div>

          {/* Nav items */}
          <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto scrollbar-none">
            {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
              const isActive = location.pathname === path
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className={cn(
                    'w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm transition-all duration-150 group',
                    isActive
                      ? 'bg-indigo-500/15 text-indigo-300 shadow-glow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                  )}
                  title={sidebarCollapsed ? label : undefined}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', isActive && 'text-indigo-400')} />
                  {!sidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex-1 text-left font-medium whitespace-nowrap overflow-hidden"
                    >
                      {label}
                    </motion.span>
                  )}
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute left-0 w-0.5 h-6 bg-indigo-500 rounded-r-full"
                    />
                  )}
                </button>
              )
            })}
          </nav>

          {/* Active context indicator */}
          {!sidebarCollapsed && activeContext && (
            <div className="mx-3 mb-2 px-3 py-2.5 rounded-xl bg-indigo-500/8 border border-indigo-500/20">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-2xs font-medium text-indigo-400 uppercase tracking-wider">Active Context</span>
              </div>
              <p className="text-2xs text-slate-400 leading-relaxed line-clamp-2">
                "{activeContext.query}"
              </p>
              <p className="text-2xs text-slate-600 mt-1">
                {activeContext.nodeCount} node{activeContext.nodeCount !== 1 ? 's' : ''} · {activeContext.sourceNames.join(', ')}
              </p>
            </div>
          )}

          {/* Stats pill */}
          {!sidebarCollapsed && stats && (
            <div className="mx-3 mb-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-2xs font-medium text-slate-500 uppercase tracking-wider">Memory</span>
                <div className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  ollamaConnected ? 'bg-emerald-400' : 'bg-amber-400'
                )} />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <StatMini label="Nodes" value={stats.totalNodes.toLocaleString()} />
                <StatMini label="Sources" value={stats.totalSources.toLocaleString()} />
                <StatMini label="Entities" value={stats.totalEntities.toLocaleString()} />
                <StatMini label="Links" value={stats.totalEdges.toLocaleString()} />
              </div>
            </div>
          )}

          {/* Bottom nav */}
          <div className="px-2 pb-4 space-y-0.5 border-t border-white/[0.04] pt-2">
            <ThemeToggle
              isDarkMode={isDarkMode}
              collapsed={sidebarCollapsed}
              onToggle={toggleTheme}
            />

            {BOTTOM_NAV.map(({ path, icon: Icon, label }) => {
              const isActive = location.pathname === path
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className={cn(
                    'w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm transition-all duration-150',
                    isActive
                      ? 'bg-indigo-500/15 text-indigo-300'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                  )}
                  title={sidebarCollapsed ? label : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="font-medium whitespace-nowrap">{label}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-cosmos-800 border border-white/[0.1] flex items-center justify-center text-slate-400 hover:text-white hover:bg-cosmos-700 transition-all z-10 shadow-card"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronLeft className="w-3 h-3" />
            )}
          </button>
        </motion.aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex-1 overflow-hidden"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <StatusBar />
    </div>
  )
}

function ThemeToggle({
  isDarkMode,
  collapsed,
  onToggle,
}: {
  isDarkMode: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  const label = isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      onClick={onToggle}
      className={cn(
        'theme-toggle group relative w-full overflow-hidden rounded-xl border transition-all duration-300',
        'border-white/[0.06] bg-white/[0.035] hover:border-indigo-500/25 hover:bg-white/[0.055]',
        collapsed ? 'h-9 px-0' : 'h-10 px-2.5'
      )}
      title={label}
      aria-label={label}
      aria-pressed={!isDarkMode}
    >
      <motion.div
        className="absolute inset-0 opacity-80"
        animate={{
          background: isDarkMode
            ? 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(6,182,212,0.04))'
            : 'linear-gradient(135deg, rgba(251,191,36,0.18), rgba(99,102,241,0.08))',
        }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      />

      <div className={cn(
        'relative flex items-center h-full',
        collapsed ? 'justify-center' : 'justify-between gap-3'
      )}>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <motion.div
              className="w-6 h-6 rounded-lg flex items-center justify-center"
              animate={{
                color: isDarkMode ? '#FBBF24' : '#6366F1',
                backgroundColor: isDarkMode ? 'rgba(251,191,36,0.12)' : 'rgba(99,102,241,0.12)',
                rotate: isDarkMode ? 0 : -12,
              }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isDarkMode ? 'sun' : 'moon'}
                  initial={{ opacity: 0, scale: 0.5, rotate: -35 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.5, rotate: 35 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                  {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </motion.span>
              </AnimatePresence>
            </motion.div>
            <span className="font-medium whitespace-nowrap text-sm text-slate-400 group-hover:text-slate-200 transition-colors">
              {isDarkMode ? 'Light Mode' : 'Dark Mode'}
            </span>
          </div>
        )}

        <div className={cn(
          'relative rounded-full border border-white/[0.08] bg-cosmos-950/60 shadow-inner',
          collapsed ? 'w-9 h-5' : 'w-11 h-6 shrink-0'
        )}>
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 rounded-full shadow-lg flex items-center justify-center"
            animate={{
              x: isDarkMode ? 2 : (collapsed ? 18 : 22),
              backgroundColor: isDarkMode ? '#111827' : '#FFFFFF',
              color: isDarkMode ? '#FBBF24' : '#6366F1',
              boxShadow: isDarkMode
                ? '0 0 18px rgba(251,191,36,0.22), 0 2px 8px rgba(0,0,0,0.35)'
                : '0 0 18px rgba(99,102,241,0.20), 0 2px 8px rgba(15,23,42,0.16)',
            }}
            transition={{ type: 'spring', stiffness: 520, damping: 32 }}
            style={{
              width: collapsed ? 16 : 18,
              height: collapsed ? 16 : 18,
            }}
          >
            {isDarkMode ? <Sun className="w-2.5 h-2.5" /> : <Moon className="w-2.5 h-2.5" />}
          </motion.div>
        </div>
      </div>
    </button>
  )
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs text-slate-600">{label}</div>
      <div className="text-xs font-semibold text-slate-300">{value}</div>
    </div>
  )
}
