import React, { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAppStore } from './store'
import { api } from './lib/api'
import AppShell from './components/layout/AppShell'
import OnboardingPage from './pages/Onboarding'
import DashboardPage from './pages/Dashboard'
import MemoryGraphPage from './pages/MemoryGraph'
import TimelinePage from './pages/Timeline'
import QueryPage from './pages/Query'
import SourcesPage from './pages/Sources'
import SettingsPage from './pages/Settings'
import PermissionsPage from './pages/Permissions'
import type {
  DataSource, Stats, AppSettings, ProcessingStatus,
  Entity, TimelineEvent
} from '../../shared/types'

export default function App(): React.ReactElement {
  const {
    onboardingComplete,
    setOnboardingComplete,
    setSources,
    setStats,
    setEntities,
    setTimeline,
    setSettings,
    setOllamaConnected,
    setProcessingStatus,
    updateSource,
    clearProcessingStatus,
  } = useAppStore()

  useEffect(() => {
    checkOnboarding()
    loadInitialData()
    setupEventListeners()
  }, [])

  function checkOnboarding() {
    const done = localStorage.getItem('cf_onboarding_complete')
    if (done === 'true') setOnboardingComplete(true)
  }

  async function loadInitialData() {
    try {
      const [sources, stats, entities, settings] = await Promise.all([
        api.sources.list(),
        api.memory.getStats(),
        api.entities.list(50),
        api.settings.get(),
      ])

      setSources(sources as DataSource[])
      setStats(stats as Stats)
      setEntities(entities as Entity[])
      setSettings(settings as AppSettings)
      setOllamaConnected((stats as Stats).ollamaConnected)

      if ((sources as DataSource[]).length > 0) {
        const timeline = await api.memory.getTimeline(50)
        setTimeline(timeline as TimelineEvent[])
      }
    } catch (err) {
      console.error('Failed to load initial data:', err)
    }
  }

  function setupEventListeners() {
    api.on('processing:status', (status: unknown) => {
      setProcessingStatus(status as ProcessingStatus)
    })

    api.on('source:synced', (data: unknown) => {
      const { id, count } = data as { id: string; count: number }
      updateSource(id, { status: 'ready', nodeCount: count })
      clearProcessingStatus(id)

      api.memory.getStats().then(s => setStats(s as Stats))
      api.entities.list(50).then(e => setEntities(e as Entity[]))
      api.memory.getTimeline(50).then(t => setTimeline(t as TimelineEvent[]))
    })

    api.on('source:error', (data: unknown) => {
      const { id } = data as { id: string }
      updateSource(id, { status: 'error' })
      clearProcessingStatus(id)
    })
  }

  return (
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route
          path="/"
          element={
            onboardingComplete
              ? <AppShell />
              : <Navigate to="/onboarding" replace />
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="graph" element={<MemoryGraphPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="query" element={<QueryPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
        </Route>
        <Route
          path="*"
          element={
            onboardingComplete
              ? <Navigate to="/" replace />
              : <Navigate to="/onboarding" replace />
          }
        />
      </Routes>
    </AnimatePresence>
  )
}
