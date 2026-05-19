import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ReactFlow, type Node, type Edge, Background,
  Controls, MiniMap, useNodesState, useEdgesState,
  BackgroundVariant, type NodeProps, Handle, Position,
  type EdgeProps, getBezierPath, MarkerType, Panel
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Search, X, Clock, Tag, GitBranch, Layers, Filter } from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { getTypeColor, formatDate, truncate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { MemoryNode } from '../../../../shared/types'

// ─── Force simulation ────────────────────────────────────────────────────────

interface SimNode { id: string; x: number; y: number; vx: number; vy: number; mass: number }
interface SimEdge { source: string; target: string; strength: number }

function runForceSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  iterations = 120
): SimNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, { ...n }]))
  const arr = Array.from(nodeMap.values())

  const centerX = 0, centerY = 0
  const repulsion = 6000
  const attraction = 0.04
  const damping = 0.82
  const centerGravity = 0.008

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations

    // Repulsion between all pairs
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j]
        const dx = b.x - a.x || 0.01
        const dy = b.y - a.y || 0.01
        const dist2 = dx * dx + dy * dy
        const dist = Math.sqrt(dist2) || 0.1
        const force = repulsion / dist2
        const fx = (dx / dist) * force * cooling
        const fy = (dy / dist) * force * cooling
        a.vx -= fx / a.mass; a.vy -= fy / a.mass
        b.vx += fx / b.mass; b.vy += fy / b.mass
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
      const idealDist = 180
      const force = (dist - idealDist) * attraction * e.strength
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx; a.vy += fy
      b.vx -= fx; b.vy -= fy
    }

    // Gravity toward center
    for (const n of arr) {
      n.vx += (centerX - n.x) * centerGravity
      n.vy += (centerY - n.y) * centerGravity
      n.vx *= damping; n.vy *= damping
      n.x += n.vx; n.y += n.vy
    }
  }

  return arr
}

// ─── Custom node ─────────────────────────────────────────────────────────────

function MemoryNodeComponent({ data, selected }: NodeProps) {
  const d = data as { label: string; type: string; color: string; size: number; nodeData?: MemoryNode }
  const color = d.color || getTypeColor(d.type)
  const size = Math.max(d.size || 20, 16)

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{ width: size * 5, minWidth: 100, maxWidth: 160 }}
      className={cn(
        'relative px-3 py-2 rounded-xl border cursor-pointer select-none transition-all duration-150',
        selected ? 'ring-2' : ''
      )}
      style={{
        background: selected
          ? `linear-gradient(135deg, ${color}25, ${color}12)`
          : 'rgba(13,17,23,0.92)',
        border: `1px solid ${selected ? color : 'rgba(255,255,255,0.08)'}`,
        boxShadow: selected
          ? `0 0 16px ${color}60, 0 0 40px ${color}25`
          : `0 0 6px ${color}18`,
        width: Math.max(size * 5, 100),
        minWidth: 100,
        maxWidth: 160,
      }}
    >
      <Handle type="target" position={Position.Top}
        style={{ background: color, width: 6, height: 6, border: 'none', opacity: 0.6 }} />

      <div className="flex items-center gap-1.5 mb-0.5">
        <motion.div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.5 + Math.random() * 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="text-2xs font-semibold uppercase tracking-widest truncate"
          style={{ color: `${color}cc` }}>
          {d.type}
        </span>
      </div>
      <div className="text-xs font-medium text-slate-200 leading-tight truncate">
        {truncate(d.label, 28)}
      </div>

      <Handle type="source" position={Position.Bottom}
        style={{ background: color, width: 6, height: 6, border: 'none', opacity: 0.6 }} />
    </motion.div>
  )
}

// ─── Animated edge ────────────────────────────────────────────────────────────

function AnimatedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const edgeData = data as { weight?: number }
  const w = edgeData?.weight || 0.5
  const color = selected ? '#818CF8' : `rgba(99,102,241,${Math.max(0.08, w * 0.5)})`
  const strokeW = selected ? 2 : 1

  return (
    <g>
      <path d={path} fill="none" stroke={color} strokeWidth={strokeW}
        style={{ filter: selected ? 'drop-shadow(0 0 4px rgba(99,102,241,0.6))' : undefined }} />
      {selected && (
        <path d={path} fill="none" stroke="rgba(99,102,241,0.3)" strokeWidth={6} />
      )}
    </g>
  )
}

const nodeTypes = { memory: MemoryNodeComponent }
const edgeTypes = { animated: AnimatedEdge }

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MemoryGraphPage(): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [totalNodes, setTotalNodes] = useState(0)
  const { setSelectedNodeId } = useAppStore()

  useEffect(() => { loadGraph() }, [])

  async function loadGraph() {
    setLoading(true)
    try {
      const graphState = await api.memory.getGraph() as {
        nodes: Array<{ id: string; label: string; type: string; color: string; size: number; data: MemoryNode }>
        edges: Array<{ id: string; source: string; target: string; weight: number }>
      }

      if (graphState.nodes.length === 0) {
        setLoading(false)
        return
      }

      setTotalNodes(graphState.nodes.length)

      // Build sim nodes — heavier nodes stay more central
      const simNodes: SimNode[] = graphState.nodes.map((n, i) => {
        const angle = (i / graphState.nodes.length) * Math.PI * 2
        const r = 300 + Math.random() * 200
        return {
          id: n.id,
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
          vx: 0, vy: 0,
          mass: 1 + (n.size || 20) / 20,
        }
      })

      const simEdges: SimEdge[] = graphState.edges.slice(0, 300).map(e => ({
        source: e.source, target: e.target, strength: e.weight || 0.5
      }))

      // Run force sim
      const placed = runForceSimulation(simNodes, simEdges, 150)
      const posMap = new Map(placed.map(n => [n.id, { x: n.x, y: n.y }]))

      const flowNodes: Node[] = graphState.nodes.map(n => ({
        id: n.id,
        type: 'memory',
        position: posMap.get(n.id) || { x: 0, y: 0 },
        data: { label: n.label, type: n.type, color: n.color, size: n.size, nodeData: n.data },
      }))

      const flowEdges: Edge[] = graphState.edges.slice(0, 400).map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'animated',
        data: { weight: e.weight },
        markerEnd: { type: MarkerType.ArrowClosed, width: 8, height: 8, color: 'rgba(99,102,241,0.3)' },
      }))

      setNodes(flowNodes)
      setEdges(flowEdges)
    } catch (err) {
      console.error('Graph load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const nd = (node.data as { nodeData?: MemoryNode }).nodeData
    if (nd) { setSelectedNode(nd); setSelectedNodeId(node.id) }
  }, [])

  const TYPE_FILTERS = ['conversation', 'document', 'code', 'note', 'decision']

  // Apply search + type filter to node visibility
  const visibleNodes = nodes.map(n => {
    const d = n.data as { label: string; type: string }
    const matchType = !filterType || d.type === filterType
    const matchSearch = !search || d.label.toLowerCase().includes(search.toLowerCase())
    return { ...n, hidden: !matchType || !matchSearch }
  })

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] shrink-0 bg-cosmos-950/40">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-white">Memory Graph</span>
          {totalNodes > 0 && (
            <span className="text-2xs text-slate-600 bg-cosmos-700/50 px-1.5 py-0.5 rounded-full">
              {totalNodes} nodes
            </span>
          )}
        </div>

        <div className="w-px h-4 bg-white/[0.08]" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search nodes…"
            className="w-44 bg-cosmos-800 border border-white/[0.06] rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/40"
          />
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-slate-600" />
          {TYPE_FILTERS.map(type => (
            <button key={type} onClick={() => setFilterType(filterType === type ? null : type)}
              className="px-2 py-1 rounded-lg text-2xs font-medium transition-all capitalize"
              style={filterType === type
                ? { backgroundColor: `${getTypeColor(type)}20`, color: getTypeColor(type) }
                : { color: '#64748b' }}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <span className="text-2xs text-slate-600">{edges.length} connections</span>
        <button onClick={loadGraph}
          className="text-2xs text-slate-500 hover:text-slate-300 border border-white/[0.06] px-2.5 py-1.5 rounded-lg transition-all hover:border-white/[0.12]">
          Refresh
        </button>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {/* Animated graph skeleton */}
            <div className="relative w-32 h-32">
              {[0, 1, 2, 3, 4].map(i => (
                <motion.div
                  key={i}
                  className="absolute w-4 h-4 rounded-full bg-indigo-500/40 border border-indigo-400/60"
                  style={{
                    left: `${50 + 35 * Math.cos((i / 5) * Math.PI * 2)}%`,
                    top: `${50 + 35 * Math.sin((i / 5) * Math.PI * 2)}%`,
                    translateX: '-50%', translateY: '-50%',
                  }}
                  animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.5, delay: i * 0.15, repeat: Infinity }}
                />
              ))}
              <motion.div
                className="absolute inset-0 rounded-full border border-indigo-500/20"
                animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.5, 0.2] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
            <p className="text-sm text-slate-400">Computing layout…</p>
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
              <GitBranch className="w-8 h-8 text-indigo-400" />
            </div>
            <p className="text-base font-semibold text-white">No graph yet</p>
            <p className="text-sm text-slate-500">Sync a source to build your knowledge graph</p>
          </div>
        ) : (
          <ReactFlow
            nodes={visibleNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.05}
            maxZoom={2.5}
            attributionPosition="bottom-left"
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(255,255,255,0.03)" />
            <Controls showInteractive={false} style={{
              background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10, gap: 2
            }} />
            <MiniMap
              nodeColor={n => (n.data as { color: string }).color || '#6366F1'}
              maskColor="rgba(4,6,13,0.8)"
              style={{
                background: 'rgba(8,11,20,0.9)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10
              }}
            />

            {/* Floating legend */}
            <Panel position="top-right" style={{ margin: 8 }}>
              <div className="bg-cosmos-900/90 border border-white/[0.06] rounded-xl p-3 backdrop-blur-sm">
                <p className="text-2xs font-medium text-slate-500 uppercase tracking-wider mb-2">Node types</p>
                {['conversation', 'document', 'code', 'decision'].map(t => (
                  <div key={t} className="flex items-center gap-2 mb-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getTypeColor(t) }} />
                    <span className="text-2xs text-slate-400 capitalize">{t}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </ReactFlow>
        )}

        {/* Node detail panel */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ opacity: 0, x: 20, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="absolute right-3 top-3 bottom-3 w-72 bg-cosmos-800/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden flex flex-col shadow-elevated"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <motion.div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getTypeColor(selectedNode.type) }}
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <span className="text-xs font-semibold text-white capitalize">{selectedNode.type}</span>
                </div>
                <button onClick={() => setSelectedNode(null)}
                  className="w-6 h-6 rounded-lg hover:bg-white/[0.08] flex items-center justify-center text-slate-500 hover:text-white transition-all">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-none p-4 space-y-3">
                <h3 className="font-semibold text-white text-sm leading-snug">{selectedNode.title}</h3>

                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(selectedNode.timestamp)}
                  </div>
                  <div className="text-slate-700">·</div>
                  <div className="truncate">{selectedNode.sourceName}</div>
                </div>

                {selectedNode.summary && (
                  <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/15">
                    <p className="text-xs text-slate-300 leading-relaxed">{selectedNode.summary}</p>
                  </div>
                )}

                <div>
                  <div className="text-2xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">Content</div>
                  <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                    {truncate(selectedNode.content, 500)}
                  </p>
                </div>

                {selectedNode.entities.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Tag className="w-3 h-3 text-slate-600" />
                      <span className="text-2xs font-medium text-slate-600 uppercase tracking-wider">Entities</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedNode.entities.map(e => (
                        <span key={e} className="text-2xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
