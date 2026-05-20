import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, Clock, Tag, GitBranch, RefreshCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useAppStore } from '../../store'
import { getTypeColor, formatDate, truncate } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { MemoryNode } from '../../../../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GNode {
  id: string
  label: string
  type: string
  color: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  connections: number
  data?: MemoryNode
}

interface GEdge {
  source: string
  target: string
  weight: number
}

// ─── Force simulation (runs every frame) ─────────────────────────────────────

class ForceGraph {
  nodes: GNode[] = []
  edges: GEdge[] = []
  alpha = 1
  alphaDecay = 0.006   // slow decay = long alive feel
  alphaMin = 0.001
  velocityDecay = 0.55

  private nodeMap = new Map<string, GNode>()

  setData(nodes: GNode[], edges: GEdge[]) {
    this.nodes = nodes
    this.edges = edges
    this.nodeMap = new Map(nodes.map(n => [n.id, n]))
    this.alpha = 1
  }

  reheat(alpha = 0.4) { this.alpha = alpha }

  tick() {
    if (this.alpha < this.alphaMin) {
      // Keep nodes gently breathing even at rest
      this.gentleBreath()
      return
    }

    const rep = 800
    const idealLen = 120
    const gravStrength = 0.012

    // Repulsion (Barnes-Hut simplified: just brute-force for < 500 nodes)
    const n = this.nodes
    for (let i = 0; i < n.length; i++) {
      for (let j = i + 1; j < n.length; j++) {
        const a = n[i], b = n[j]
        let dx = b.x - a.x, dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5 }
        const d = Math.sqrt(d2) || 1
        const f = (rep / d2) * this.alpha
        a.vx -= (dx / d) * f
        a.vy -= (dy / d) * f
        b.vx += (dx / d) * f
        b.vy += (dy / d) * f
      }
    }

    // Attraction along edges
    for (const e of this.edges) {
      const a = this.nodeMap.get(e.source)
      const b = this.nodeMap.get(e.target)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = ((d - idealLen) * 0.06 * e.weight) * this.alpha
      a.vx += (dx / d) * f; a.vy += (dy / d) * f
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
    }

    // Gravity toward center
    for (const nd of this.nodes) {
      nd.vx -= nd.x * gravStrength * this.alpha
      nd.vy -= nd.y * gravStrength * this.alpha
      nd.vx *= this.velocityDecay
      nd.vy *= this.velocityDecay
      nd.x += nd.vx
      nd.y += nd.vy
    }

    this.alpha *= (1 - this.alphaDecay)
  }

  private gentleBreath() {
    // Tiny random nudge so the graph never looks completely dead
    for (const nd of this.nodes) {
      nd.vx += (Math.random() - 0.5) * 0.08
      nd.vy += (Math.random() - 0.5) * 0.08
      nd.vx *= 0.92
      nd.vy *= 0.92
      nd.x += nd.vx
      nd.y += nd.vy
    }
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MemoryGraphPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const sim = useRef(new ForceGraph())

  // View state
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1) // for UI display only

  // Interaction
  const dragNode = useRef<GNode | null>(null)
  const isPanning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const hoveredNode = useRef<GNode | null>(null)

  // UI state
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string | null>(null)
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 })
  const { setSelectedNodeId } = useAppStore()

  // ─── Load data ──────────────────────────────────────────────────────────────

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setSelectedNode(null)
    try {
      const gs = await api.memory.getGraph() as {
        nodes: Array<{ id: string; label: string; type: string; color: string; size: number; data: MemoryNode }>
        edges: Array<{ id: string; source: string; target: string; weight: number }>
      }
      if (!gs.nodes.length) { setLoading(false); return }

      setCounts({ nodes: gs.nodes.length, edges: gs.edges.length })

      const connCount = new Map<string, number>()
      gs.edges.forEach(e => {
        connCount.set(e.source, (connCount.get(e.source) ?? 0) + 1)
        connCount.set(e.target, (connCount.get(e.target) ?? 0) + 1)
      })

      const n = gs.nodes.length
      const nodes: GNode[] = gs.nodes.map((nd, i) => {
        const angle = (i / n) * Math.PI * 2
        const r = Math.max(200, n * 10)
        const conns = connCount.get(nd.id) ?? 0
        return {
          id: nd.id,
          label: nd.label,
          type: nd.type,
          color: nd.color || getTypeColor(nd.type),
          x: Math.cos(angle) * r + (Math.random() - 0.5) * 80,
          y: Math.sin(angle) * r + (Math.random() - 0.5) * 80,
          vx: 0, vy: 0,
          radius: Math.max(5, Math.min(14, 5 + conns * 1.2)),
          connections: conns,
          data: nd.data,
        }
      })

      const edges: GEdge[] = gs.edges.slice(0, 800).map(e => ({
        source: e.source, target: e.target, weight: Math.max(0.1, e.weight ?? 0.5),
      }))

      sim.current.setData(nodes, edges)
      centerView()
      setLoading(false)
    } catch (e) {
      console.error(e)
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGraph() }, [])

  // ─── Render loop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (loading) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
      ctx.scale(devicePixelRatio, devicePixelRatio)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const searchLower = search.toLowerCase()

    function draw() {
      const W = canvas.offsetWidth, H = canvas.offsetHeight
      ctx.clearRect(0, 0, W, H)

      ctx.save()
      ctx.translate(panRef.current.x + W / 2, panRef.current.y + H / 2)
      ctx.scale(zoomRef.current, zoomRef.current)

      const nodes = sim.current.nodes
      const edges = sim.current.edges
      const nodeMap = new Map(nodes.map(n => [n.id, n]))

      const isFiltered = filterType || searchLower
      const matchNode = (nd: GNode) => {
        if (filterType && nd.type !== filterType) return false
        if (searchLower && !nd.label.toLowerCase().includes(searchLower)) return false
        return true
      }

      // ── Edges ──
      for (const e of edges) {
        const a = nodeMap.get(e.source), b = nodeMap.get(e.target)
        if (!a || !b) continue
        const aMatch = !isFiltered || matchNode(a)
        const bMatch = !isFiltered || matchNode(b)
        const opacity = isFiltered
          ? (aMatch && bMatch ? e.weight * 0.5 : 0.03)
          : Math.max(0.04, e.weight * 0.3)

        ctx.beginPath()
        ctx.moveTo(a.x, a.y)

        // Slight curve for web feel
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15
        const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15
        ctx.quadraticCurveTo(mx, my, b.x, b.y)

        const isHovered = hoveredNode.current &&
          (e.source === hoveredNode.current.id || e.target === hoveredNode.current.id)

        if (isHovered) {
          ctx.strokeStyle = `rgba(99,102,241,${Math.min(0.9, opacity * 3)})`
          ctx.lineWidth = 1.5
        } else {
          ctx.strokeStyle = `rgba(99,102,241,${opacity})`
          ctx.lineWidth = Math.max(0.3, e.weight * 0.8)
        }
        ctx.stroke()
      }

      // ── Nodes ──
      for (const nd of nodes) {
        const match = !isFiltered || matchNode(nd)
        const isHov = hoveredNode.current?.id === nd.id
        const isSel = selectedNode?.id === nd.id
        const alpha = match ? 1 : 0.12

        ctx.globalAlpha = alpha

        // Glow
        if (match && (isHov || isSel)) {
          ctx.shadowColor = nd.color
          ctx.shadowBlur = isSel ? 24 : 14
        } else if (match) {
          ctx.shadowColor = nd.color
          ctx.shadowBlur = 6
        } else {
          ctx.shadowBlur = 0
        }

        const r = nd.radius * (isHov ? 1.3 : isSel ? 1.5 : 1)

        // Outer ring for selected/hovered
        if (isSel || isHov) {
          ctx.beginPath()
          ctx.arc(nd.x, nd.y, r + 5, 0, Math.PI * 2)
          ctx.strokeStyle = nd.color + (isSel ? 'aa' : '55')
          ctx.lineWidth = 1
          ctx.stroke()
        }

        // Node fill
        ctx.beginPath()
        ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2)
        const grad = ctx.createRadialGradient(nd.x - r * 0.3, nd.y - r * 0.3, 0, nd.x, nd.y, r)
        grad.addColorStop(0, nd.color + (isSel ? 'ff' : 'dd'))
        grad.addColorStop(1, nd.color + '55')
        ctx.fillStyle = grad
        ctx.fill()

        // Label — only when zoomed in enough or selected/hovered
        const z = zoomRef.current
        if ((z > 0.6 && match) || isSel || isHov) {
          ctx.shadowBlur = 0
          ctx.globalAlpha = Math.min(1, (z - 0.4) * 2) * alpha
          ctx.fillStyle = isSel ? '#ffffff' : '#94A3B8'
          ctx.font = `${Math.max(9, 10 / z)}px -apple-system,sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(truncate(nd.label, 18), nd.x, nd.y + r + 12 / z)
        }

        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
      }

      ctx.restore()
      sim.current.tick()
      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [loading, search, filterType, selectedNode])

  // ─── View helpers ─────────────────────────────────────────────────────────

  function centerView() {
    panRef.current = { x: 0, y: 0 }
    zoomRef.current = 0.8
    setZoom(0.8)
  }

  function applyZoom(delta: number, cx?: number, cy?: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    const oldZoom = zoomRef.current
    const newZoom = Math.max(0.05, Math.min(4, oldZoom * (1 + delta)))

    if (cx !== undefined && cy !== undefined) {
      // Zoom toward cursor
      const wx = (cx - W / 2 - panRef.current.x) / oldZoom
      const wy = (cy - H / 2 - panRef.current.y) / oldZoom
      panRef.current.x = cx - W / 2 - wx * newZoom
      panRef.current.y = cy - H / 2 - wy * newZoom
    }

    zoomRef.current = newZoom
    setZoom(newZoom)
  }

  // ─── Canvas → world coords ────────────────────────────────────────────────

  function toWorld(cx: number, cy: number) {
    const canvas = canvasRef.current!
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    return {
      x: (cx - W / 2 - panRef.current.x) / zoomRef.current,
      y: (cy - H / 2 - panRef.current.y) / zoomRef.current,
    }
  }

  function nodeAt(cx: number, cy: number): GNode | null {
    const { x, y } = toWorld(cx, cy)
    let best: GNode | null = null, bestD = Infinity
    for (const nd of sim.current.nodes) {
      const d = Math.hypot(nd.x - x, nd.y - y)
      if (d < nd.radius * 3 && d < bestD) { best = nd; bestD = d }
    }
    return best
  }

  // ─── Mouse events ─────────────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const delta = -e.deltaY * 0.001 * (e.deltaMode === 1 ? 10 : 1)
    applyZoom(delta, cx, cy)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    lastMouse.current = { x: cx, y: cy }

    const hit = nodeAt(cx, cy)
    if (hit) {
      dragNode.current = hit
      hit.vx = 0; hit.vy = 0
    } else {
      isPanning.current = true
    }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const dx = cx - lastMouse.current.x, dy = cy - lastMouse.current.y
    lastMouse.current = { x: cx, y: cy }

    if (dragNode.current) {
      const nd = dragNode.current
      const { x, y } = toWorld(cx, cy)
      nd.x = x; nd.y = y
      nd.vx = 0; nd.vy = 0
      sim.current.reheat(0.3)
    } else if (isPanning.current) {
      panRef.current.x += dx
      panRef.current.y += dy
    } else {
      hoveredNode.current = nodeAt(cx, cy)
      canvasRef.current!.style.cursor = hoveredNode.current ? 'pointer' : 'grab'
    }
  }, [])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragNode.current) {
      dragNode.current = null
    } else if (isPanning.current) {
      isPanning.current = false
    } else {
      const rect = canvasRef.current!.getBoundingClientRect()
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top
      const hit = nodeAt(cx, cy)
      if (hit?.data) {
        setSelectedNode(prev => prev?.id === hit.id ? null : hit.data!)
        setSelectedNodeId(hit.id)
      } else {
        setSelectedNode(null)
      }
    }
  }, [])

  const onMouseLeave = useCallback(() => {
    dragNode.current = null
    isPanning.current = false
    hoveredNode.current = null
  }, [])

  // Touch support
  const lastTouch = useRef<{ x: number; y: number; dist?: number } | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      lastTouch.current = { x: t.clientX, y: t.clientY }
      const rect = canvasRef.current!.getBoundingClientRect()
      const hit = nodeAt(t.clientX - rect.left, t.clientY - rect.top)
      if (hit) dragNode.current = hit
      else isPanning.current = true
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX
      const dy = e.touches[1].clientY - e.touches[0].clientY
      lastTouch.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        dist: Math.hypot(dx, dy),
      }
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 1 && lastTouch.current) {
      const t = e.touches[0]
      const dx = t.clientX - lastTouch.current.x
      const dy = t.clientY - lastTouch.current.y
      if (dragNode.current) {
        const rect = canvasRef.current!.getBoundingClientRect()
        const { x, y } = toWorld(t.clientX - rect.left, t.clientY - rect.top)
        dragNode.current.x = x; dragNode.current.y = y
      } else {
        panRef.current.x += dx; panRef.current.y += dy
      }
      lastTouch.current = { x: t.clientX, y: t.clientY }
    } else if (e.touches.length === 2 && lastTouch.current?.dist) {
      const dx = e.touches[1].clientX - e.touches[0].clientX
      const dy = e.touches[1].clientY - e.touches[0].clientY
      const dist = Math.hypot(dx, dy)
      const delta = (dist - lastTouch.current.dist) / lastTouch.current.dist * 0.8
      applyZoom(delta)
      lastTouch.current.dist = dist
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    dragNode.current = null; isPanning.current = false; lastTouch.current = null
  }, [])

  const TYPE_FILTERS = [
    { key: 'conversation', label: 'Chat' },
    { key: 'document', label: 'Docs' },
    { key: 'code', label: 'Code' },
    { key: 'decision', label: 'Decisions' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.05] shrink-0 bg-cosmos-950/70 backdrop-blur-md">
        <GitBranch className="w-4 h-4 text-indigo-400" />
        <span className="text-sm font-semibold text-white">Memory Graph</span>
        {counts.nodes > 0 && (
          <span className="text-2xs text-slate-600 bg-white/[0.04] px-2 py-0.5 rounded-full">
            {counts.nodes} nodes · {counts.edges} links
          </span>
        )}

        <div className="w-px h-4 bg-white/[0.06]" />

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter…"
            className="w-36 bg-white/[0.04] border border-white/[0.06] rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-colors"
          />
        </div>

        {TYPE_FILTERS.map(f => (
          <button key={f.key}
            onClick={() => setFilterType(filterType === f.key ? null : f.key)}
            className="px-2.5 py-1 rounded-lg text-2xs font-medium transition-all duration-150"
            style={filterType === f.key
              ? { background: `${getTypeColor(f.key)}20`, color: getTypeColor(f.key) }
              : { color: '#475569' }}
          >
            {f.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg px-1 py-0.5">
          <button onClick={() => applyZoom(-0.25)}
            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-2xs text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => applyZoom(0.25)}
            className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>

        <button onClick={centerView}
          className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white border border-white/[0.06] rounded-lg transition-all hover:border-white/[0.12]">
          <Maximize2 className="w-3 h-3" />
        </button>

        <button onClick={loadGraph}
          className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white border border-white/[0.06] rounded-lg transition-all hover:border-white/[0.12]">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden bg-cosmos-950">
        {/* Ambient orbs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute w-[500px] h-[500px] rounded-full blur-[120px] opacity-[0.07]"
            style={{ background: 'radial-gradient(circle,#6366F1,transparent)', left: '5%', top: '10%' }} />
          <div className="absolute w-[400px] h-[400px] rounded-full blur-[100px] opacity-[0.05]"
            style={{ background: 'radial-gradient(circle,#8B5CF6,transparent)', right: '10%', bottom: '15%' }} />
          <div className="absolute w-[300px] h-[300px] rounded-full blur-[80px] opacity-[0.04]"
            style={{ background: 'radial-gradient(circle,#06B6D4,transparent)', left: '55%', top: '55%' }} />
        </div>

        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
            <div className="relative w-24 h-24">
              {[0,1,2,3,4,5].map(i => (
                <motion.div key={i}
                  className="absolute w-2.5 h-2.5 rounded-full"
                  style={{
                    left: `${50 + 40 * Math.cos(i / 6 * Math.PI * 2)}%`,
                    top: `${50 + 40 * Math.sin(i / 6 * Math.PI * 2)}%`,
                    translateX: '-50%', translateY: '-50%',
                    background: getTypeColor(['conversation','document','code','decision','note','entity'][i]),
                  }}
                  animate={{ scale: [0.5,1.4,0.5], opacity: [0.3,1,0.3] }}
                  transition={{ duration: 1.6, delay: i*0.18, repeat: Infinity, ease: 'easeInOut' }}
                />
              ))}
              <motion.div className="absolute inset-0 rounded-full border border-indigo-500/20"
                animate={{ scale: [0.8,1.2,0.8], opacity: [0,0.5,0] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-300">Building your web</p>
              <p className="text-xs text-slate-600 mt-1">Running force simulation…</p>
            </div>
          </div>
        ) : sim.current.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <motion.div animate={{ y: [0,-8,0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
              <GitBranch className="w-8 h-8 text-indigo-400" />
            </motion.div>
            <p className="text-sm font-semibold text-white">No graph yet</p>
            <p className="text-xs text-slate-500">Sync a source to build your knowledge graph</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ cursor: 'grab' }}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />
        )}

        {/* Zoom hint */}
        {!loading && sim.current.nodes.length > 0 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-2xs text-slate-700 pointer-events-none">
            Scroll to zoom · Drag to pan · Click node for details
          </div>
        )}

        {/* Node detail panel */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ opacity: 0, x: 16, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              className="absolute right-3 top-3 bottom-3 w-72 flex flex-col rounded-2xl overflow-hidden"
              style={{
                background: 'rgba(8,11,20,0.94)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.07)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
              }}
            >
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <motion.div className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getTypeColor(selectedNode.type), boxShadow: `0 0 8px ${getTypeColor(selectedNode.type)}80` }}
                    animate={{ scale: [1,1.25,1], opacity: [0.7,1,0.7] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <span className="text-xs font-semibold text-white capitalize">{selectedNode.type}</span>
                </div>
                <button onClick={() => setSelectedNode(null)}
                  className="w-6 h-6 rounded-lg hover:bg-white/[0.08] flex items-center justify-center text-slate-500 hover:text-white transition-all">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-none">
                <h3 className="font-semibold text-white text-sm leading-snug">{selectedNode.title}</h3>
                <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(selectedNode.timestamp)}</span>
                  <span className="text-slate-700">·</span>
                  <span className="truncate max-w-[140px]">{selectedNode.sourceName}</span>
                </div>

                {selectedNode.summary && (
                  <div className="p-3 rounded-xl border"
                    style={{ background: `${getTypeColor(selectedNode.type)}08`, borderColor: `${getTypeColor(selectedNode.type)}20` }}>
                    <p className="text-xs text-slate-300 leading-relaxed">{selectedNode.summary}</p>
                  </div>
                )}

                <div>
                  <div className="text-2xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">Content</div>
                  <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{truncate(selectedNode.content, 500)}</p>
                </div>

                {selectedNode.entities.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Tag className="w-3 h-3 text-slate-600" />
                      <span className="text-2xs font-medium text-slate-600 uppercase tracking-wider">Entities</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.entities.map(e => (
                        <span key={e} className="text-2xs px-2 py-0.5 rounded-full border"
                          style={{ background: `${getTypeColor(selectedNode.type)}10`, borderColor: `${getTypeColor(selectedNode.type)}30`, color: getTypeColor(selectedNode.type) }}>
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
