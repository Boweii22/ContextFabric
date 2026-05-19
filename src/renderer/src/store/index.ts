import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  DataSource, MemoryNode, Entity, TimelineEvent, Stats,
  AIQueryResult, SearchResult, AppSettings, ProcessingStatus
} from '../../../shared/types'

interface AppStore {
  // Navigation
  currentPage: string
  setCurrentPage: (page: string) => void

  // Onboarding
  onboardingComplete: boolean
  setOnboardingComplete: (val: boolean) => void
  onboardingStep: number
  setOnboardingStep: (step: number) => void

  // Sources
  sources: DataSource[]
  setSources: (sources: DataSource[]) => void
  updateSource: (id: string, updates: Partial<DataSource>) => void

  // Stats
  stats: Stats | null
  setStats: (stats: Stats) => void

  // Entities
  entities: Entity[]
  setEntities: (entities: Entity[]) => void

  // Timeline
  timeline: TimelineEvent[]
  setTimeline: (events: TimelineEvent[]) => void

  // Search
  searchQuery: string
  setSearchQuery: (q: string) => void
  searchResults: SearchResult[]
  setSearchResults: (results: SearchResult[]) => void
  isSearching: boolean
  setIsSearching: (v: boolean) => void

  // AI Query
  queryResult: AIQueryResult | null
  setQueryResult: (result: AIQueryResult | null) => void
  isQuerying: boolean
  setIsQuerying: (v: boolean) => void
  queryHistory: AIQueryResult[]
  addToHistory: (result: AIQueryResult) => void

  // Processing
  processingStatuses: Record<string, ProcessingStatus>
  setProcessingStatus: (status: ProcessingStatus) => void
  clearProcessingStatus: (sourceId: string) => void

  // Settings
  settings: AppSettings | null
  setSettings: (settings: AppSettings) => void

  // Ollama
  ollamaConnected: boolean
  setOllamaConnected: (v: boolean) => void

  // Selected node
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void

  // UI state
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  rightPanelOpen: boolean
  setRightPanelOpen: (v: boolean) => void
}

export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set) => ({
    currentPage: 'dashboard',
    setCurrentPage: (page) => set({ currentPage: page }),

    onboardingComplete: false,
    setOnboardingComplete: (val) => set({ onboardingComplete: val }),
    onboardingStep: 0,
    setOnboardingStep: (step) => set({ onboardingStep: step }),

    sources: [],
    setSources: (sources) => set({ sources }),
    updateSource: (id, updates) =>
      set(state => ({
        sources: state.sources.map(s => s.id === id ? { ...s, ...updates } : s)
      })),

    stats: null,
    setStats: (stats) => set({ stats }),

    entities: [],
    setEntities: (entities) => set({ entities }),

    timeline: [],
    setTimeline: (timeline) => set({ timeline }),

    searchQuery: '',
    setSearchQuery: (q) => set({ searchQuery: q }),
    searchResults: [],
    setSearchResults: (results) => set({ searchResults: results }),
    isSearching: false,
    setIsSearching: (v) => set({ isSearching: v }),

    queryResult: null,
    setQueryResult: (result) => set({ queryResult: result }),
    isQuerying: false,
    setIsQuerying: (v) => set({ isQuerying: v }),
    queryHistory: [],
    addToHistory: (result) =>
      set(state => ({ queryHistory: [result, ...state.queryHistory].slice(0, 20) })),

    processingStatuses: {},
    setProcessingStatus: (status) =>
      set(state => ({
        processingStatuses: { ...state.processingStatuses, [status.sourceId]: status }
      })),
    clearProcessingStatus: (sourceId) =>
      set(state => {
        const next = { ...state.processingStatuses }
        delete next[sourceId]
        return { processingStatuses: next }
      }),

    settings: null,
    setSettings: (settings) => set({ settings }),

    ollamaConnected: false,
    setOllamaConnected: (v) => set({ ollamaConnected: v }),

    selectedNodeId: null,
    setSelectedNodeId: (id) => set({ selectedNodeId: id }),

    sidebarCollapsed: false,
    setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    rightPanelOpen: false,
    setRightPanelOpen: (v) => set({ rightPanelOpen: v }),
  }))
)
