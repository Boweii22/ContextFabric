import React, { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ReactFlow, type Node, type Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  BackgroundVariant, type NodeProps, Handle, Position,
  getBezierPath, type EdgeProps, MarkerType
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Search, Filter, ZoomIn, ZoomOut, Maximize2,
  X, GitBranch, ExternalLink, Clock, Tag
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { getTypeColor, formatDate, truncate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { GraphState, MemoryNode } from '../../../../shared/types'

// Custom node component
function MemoryNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as { label: string; type: string; color: string; nodeData?: MemoryNode }
  const color = nodeData.color || getTypeColor(nodeData.type)

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={cn(
        'relative px-3 py-2 rounded-xl border transition-all duration-200 cursor-pointer',
        selected
          ? 'border-indigo-400 shadow-glow bg-indigo-500/15'
          : 'border-white/10 bg-cosmos-800/90 hover:border-white/20'
      )}
      style={{
        boxShadow: selected ? `0 0 20px ${color}40` : `0 0 8px ${color}20`,
        minWidth: 120,
        maxWidth: 180,
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !bg-white/30 !border-0" />

      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-2xs font-medium uppercase tracking-wide" style={{ color: `${color}cc` }}>
          {nodeData.type}
        </span>
      </div>
      <div className="text-xs font-medium text-slate-200 leading-tight">
        {truncate(nodeData.label, 35)}
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5 !bg-white/30 !border-0" />
    </motion.div>
  )
}

// Custom edge
function GlowEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected
}: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const edgeData = data as { type?: string; weight?: number }
  const opacity = selected ? 0.8 : Math.max(0.15, (edgeData?.weight || 0.5) * 0.6)

  return (
    <path
      id={id}
      d={edgePath}
      strokeWidth={selected ? 2 : 1}
      stroke={selected ? '#6366F1' : 'rgba(99,102,241,0.6)'}
      fill="none"
      strokeOpacity={opacity}
      style={{ filter: selected ? 'drop-shadow(0 0 4px rgba(99,102,241,0.6))' : undefined }}
    />
  )
}

const nodeTypes = { memory: MemoryNodeComponent }
const edgeTypes = { glow: GlowEdge }

export default function MemoryGraphPage(): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { setSelectedNodeId } = useAppStore()

  useEffect(() => {
    loadGraph()
  }, [])

  async function loadGraph() {
    setLoading(true)
    try {
      const graphState = await api.memory.getGraph() as GraphState

      // Layout nodes in force-directed positions (simplified)
      const nodeMap = new Map<string, { x: number; y: number }>()
      const layoutNodes = layoutGraph(graphState.nodes, graphState.edges)

      const flowNodes: Node[] = graphState.nodes.map((n, i) => ({
        id: n.id,
        type: 'memory',
        position: layoutNodes[i] || { x: Math.random() * 1200 - 600, y: Math.random() * 800 - 400 },
        data: {
          label: n.label,
          type: n.type,
          color: n.color,
          nodeData: n.data,
        },
      }))

      const flowEdges: Edge[] = graphState.edges.slice(0, 500).map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'glow',
        data: { weight: e.weight, type: e.type },
        markerEnd: { type: MarkerType.Arrow, width: 8, height: 8, color: 'rgba(99,102,241,0.4)' },
      }))

      setNodes(flowNodes)
      setEdges(flowEdges)
    } catch (err) {
      console.error('Failed to load graph:', err)
    } finally {
      setLoading(false)
    }
  }

  function layoutGraph(nodes: { id: string }[], edges: { source: string; target: string }[]): Array<{ x: number; y: number }> {
    // Simple circular + force layout
    const positions: Array<{ x: number; y: number }> = []
    const n = nodes.length

    if (n === 0) return positions

    // Arrange in clusters
    const radius = Math.max(300, n * 15)
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2
      const r = radius + Math.random() * 100 - 50
      positions.push({
        x: Math.cos(angle) * r + (Math.random() * 80 - 40),
        y: Math.sin(angle) * r + (Math.random() * 80 - 40),
      })
    }

    return positions
  }

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const nodeData = node.data as { nodeData?: MemoryNode }
    if (nodeData?.nodeData) {
      setSelectedNode(nodeData.nodeData)
      setSelectedNodeId(node.id)
    }
  }, [])

  const typeFilters = ['conversation', 'document', 'code', 'note', 'decision']

  const filteredNodes = filterType
    ? nodes.map(n => ({
        ...n,
        hidden: (n.data as { type: string }).type !== filterType
      }))
    : nodes

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-cosmos-950/30 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-indigo-400" />
          <h1 className="text-sm font-semibold text-white">Memory Graph</h1>
        </div>

        <div className="w-px h-4 bg-white/[0.08]" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-48 bg-cosmos-800 border border-white/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/40"
          />
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-1.5">
          {typeFilters.map(type => (
            <button
              key={type}
              onClick={() => setFilterType(filterType === type ? null : type)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                filterType === type
                  ? 'text-white'
                  : 'text-slate-500 hover:text-slate-300'
              )}
              style={filterType === type ? {
                backgroundColor: `${getTypeColor(type)}20`,
                color: getTypeColor(type),
              } : undefined}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="text-xs text-slate-600">
          {nodes.length} nodes · {edges.length} connections
        </div>

        <button
          onClick={loadGraph}
          className="text-xs text-slate-500 hover:text-slate-300 border border-white/[0.06] hover:border-white/[0.12] px-3 py-1.5 rounded-lg transition-all"
        >
          Refresh
        </button>
      </div>

      {/* Graph */}
      <div className="flex-1 relative overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                className="w-12 h-12 rounded-full border-2 border-indigo-500 border-t-transparent mx-auto mb-4"
              />
              <p className="text-sm text-slate-500">Building your memory graph...</p>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 rounded-3xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
                <GitBranch className="w-10 h-10 text-indigo-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">No Memory Graph Yet</h3>
              <p className="text-sm text-slate-500">Connect and sync sources to build your knowledge graph</p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={filteredNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.1}
            maxZoom={2}
            attributionPosition="bottom-left"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={32}
              size={1}
              color="rgba(255,255,255,0.04)"
            />
            <Controls
              style={{
                background: 'rgba(13, 17, 23, 0.9)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
              }}
            />
            <MiniMap
              style={{
                background: 'rgba(8, 11, 20, 0.9)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
              }}
              nodeColor={(n) => (n.data as { color: string }).color || '#6366F1'}
              maskColor="rgba(8,11,20,0.7)"
            />
          </ReactFlow>
        )}

        {/* Node detail panel */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute right-4 top-4 bottom-4 w-80 bg-cosmos-800/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden flex flex-col shadow-elevated"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getTypeColor(selectedNode.type) }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {selectedNode.type}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="w-6 h-6 rounded-lg hover:bg-white/[0.08] flex items-center justify-center text-slate-500 hover:text-slate-300 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4 scrollbar-none">
                <h3 className="font-semibold text-white text-sm mb-2 leading-tight">
                  {selectedNode.title}
                </h3>

                <div className="flex items-center gap-3 mb-3 text-xs text-slate-500">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(selectedNode.timestamp)}
                  </div>
                  <div className="flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" />
                    {selectedNode.sourceName}
                  </div>
                </div>

                {selectedNode.summary && (
                  <div className="p-3 rounded-xl bg-cosmos-700/50 mb-3">
                    <div className="text-2xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Summary</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{selectedNode.summary}</p>
                  </div>
                )}

                <div className="mb-3">
                  <div className="text-2xs font-medium text-slate-500 uppercase tracking-wide mb-2">Content</div>
                  <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                    {truncate(selectedNode.content, 600)}
                  </p>
                </div>

                {selectedNode.entities.length > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Tag className="w-3 h-3 text-slate-500" />
                      <div className="text-2xs font-medium text-slate-500 uppercase tracking-wide">Entities</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.entities.map(entity => (
                        <span
                          key={entity}
                          className="text-2xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                        >
                          {entity}
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
