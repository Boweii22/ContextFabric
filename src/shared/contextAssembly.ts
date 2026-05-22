import type { MemoryNode } from './types'

export type ContextAssemblyApp = 'claude' | 'chatgpt' | 'cursor' | 'generic'

export interface ContextAssemblyInput {
  appId: string
  query?: string
  nodes: MemoryNode[]
  maxWords?: number
}

export interface ContextAssemblyResult {
  payload: string
  appFormat: ContextAssemblyApp
  usedNodeIds: string[]
  warnings: string[]
  wordCount: number
}

export const DEFAULT_ASSEMBLY_MAX_WORDS = 800

export const PAYLOAD_ASSEMBLY_SYSTEM_PROMPT = `You are ContextFabric's local Gemma 4 payload assembler.

Goal:
Turn user-approved local memory nodes into one coherent context brief for another AI tool.

Rules:
- Use ONLY the supplied memory nodes. Do not invent facts, names, features, dates, metrics, or claims.
- Prefer stable project, decision, style, preference, and person nodes over raw conversation/code snippets.
- Write a useful brief, not a JSON dump.
- Include source node ids inline as [node:id] after concrete claims.
- If the nodes do not support a requested claim, omit it.
- Respect the requested app format.
- Stay under the requested maximum word count.

App formats:
- claude: concise prose with sections "Context", "Decisions", "Working Style", "How to Use This".
- chatgpt: short bullet-oriented brief with "Known Context", "Preferences", "Relevant Sources".
- cursor: engineering-focused brief with "Project", "Architecture / Decisions", "Coding Preferences", "Files / Sources".
- generic: compact neutral brief with clear source ids.

Return JSON only:
{
  "payload": "the final context brief",
  "usedNodeIds": ["node-id"],
  "warnings": ["optional warning when data is thin or uncertain"]
}`

export function normalizeAssemblyApp(appId: string): ContextAssemblyApp {
  const id = appId.toLowerCase()
  if (id.includes('claude')) return 'claude'
  if (id.includes('chatgpt') || id.includes('openai')) return 'chatgpt'
  if (id.includes('cursor') || id.includes('vscode')) return 'cursor'
  return 'generic'
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function trimToWords(text: string, maxWords = DEFAULT_ASSEMBLY_MAX_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return text.trim()
  return `${words.slice(0, maxWords).join(' ')}\n\n[ContextFabric trimmed this brief to the configured limit.]`
}

export function buildContextAssemblyPrompt(input: ContextAssemblyInput): string {
  const maxWords = clampMaxWords(input.maxWords)
  const appFormat = normalizeAssemblyApp(input.appId)
  const nodeLines = input.nodes.slice(0, 24).map((node, index) => {
    const text = (node.summary || node.content).replace(/\s+/g, ' ').slice(0, 700)
    return [
      `Node ${index + 1}`,
      `id=${node.id}`,
      `type=${node.type}`,
      `title=${node.title}`,
      `source=${node.sourceName}`,
      `confidence=${Number(node.confidence || 0).toFixed(2)}`,
      `text=${text}`,
    ].join('\n')
  }).join('\n\n')

  return `${PAYLOAD_ASSEMBLY_SYSTEM_PROMPT}

Requested app format: ${appFormat}
Requested app id: ${input.appId}
Query/request: ${input.query || 'general project context'}
Maximum words: ${maxWords}

Memory nodes:
${nodeLines || 'No nodes supplied.'}

Return JSON only:`
}

export function parseContextAssembly(raw: string, input: ContextAssemblyInput): ContextAssemblyResult {
  const fallback = buildFallbackContextPayload(input)
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return fallback

  try {
    const parsed = JSON.parse(repairJson(jsonText)) as {
      payload?: unknown
      usedNodeIds?: unknown
      warnings?: unknown
    }
    const allowedIds = new Set(input.nodes.map(node => node.id))
    const usedNodeIds = Array.isArray(parsed.usedNodeIds)
      ? parsed.usedNodeIds.map(String).filter(id => allowedIds.has(id))
      : []
    const payload = typeof parsed.payload === 'string' ? parsed.payload.trim() : ''
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 6) : []
    if (!payload) return fallback

    const grounded = validateAssemblyGrounding(payload, input.nodes, usedNodeIds)
    const maxWords = clampMaxWords(input.maxWords)
    const finalPayload = trimToWords(payload, maxWords)
    return {
      payload: finalPayload,
      appFormat: normalizeAssemblyApp(input.appId),
      usedNodeIds: usedNodeIds.length > 0 ? usedNodeIds : grounded.referencedNodeIds,
      warnings: [...warnings, ...grounded.warnings],
      wordCount: countWords(finalPayload),
    }
  } catch {
    return fallback
  }
}

export function buildFallbackContextPayload(input: ContextAssemblyInput): ContextAssemblyResult {
  const appFormat = normalizeAssemblyApp(input.appId)
  const maxWords = clampMaxWords(input.maxWords)
  const typed = preferredNodes(input.nodes)
  const byType = new Map<string, MemoryNode[]>()
  for (const node of typed) {
    const list = byType.get(node.type) || []
    list.push(node)
    byType.set(node.type, list)
  }

  const lines: string[] = []
  if (appFormat === 'cursor') {
    lines.push('Project')
    appendSection(lines, byType, ['project'], 3, ['document', 'note', 'conversation', 'code'])
    lines.push('', 'Architecture / Decisions')
    appendSection(lines, byType, ['decision'], 4)
    lines.push('', 'Coding Preferences')
    appendSection(lines, byType, ['style', 'preference'], 4)
    lines.push('', 'Files / Sources')
    appendSources(lines, typed)
  } else if (appFormat === 'claude') {
    lines.push('Context')
    appendSection(lines, byType, ['project'], 3, ['document', 'note', 'conversation', 'code'])
    lines.push('', 'Decisions')
    appendSection(lines, byType, ['decision'], 4)
    lines.push('', 'Working Style')
    appendSection(lines, byType, ['style', 'preference', 'person'], 5, ['document', 'note', 'conversation'])
    lines.push('', 'How to Use This')
    lines.push('- Treat these memories as background context and cite node ids for project-specific claims.')
  } else if (appFormat === 'chatgpt') {
    lines.push('Known Context')
    appendSection(lines, byType, ['project', 'decision'], 6, ['document', 'note', 'conversation', 'code'])
    lines.push('', 'Preferences')
    appendSection(lines, byType, ['style', 'preference'], 5)
    lines.push('', 'Relevant Sources')
    appendSources(lines, typed)
  } else {
    lines.push('ContextFabric Brief')
    appendSection(lines, byType, ['project', 'decision', 'style', 'preference', 'person', 'document', 'note', 'code', 'conversation'], 10)
  }

  const payload = trimToWords(lines.join('\n').replace(/\n{3,}/g, '\n\n'), maxWords)
  return {
    payload,
    appFormat,
    usedNodeIds: typed.map(node => node.id).slice(0, 12),
    warnings: typed.length === 0 ? ['No approved memory nodes were available for assembly.'] : [],
    wordCount: countWords(payload),
  }
}

export function validateAssemblyGrounding(payload: string, nodes: MemoryNode[], usedNodeIds: string[] = []): { ok: boolean; warnings: string[]; referencedNodeIds: string[] } {
  const allowedIds = new Set(nodes.map(node => node.id))
  const referencedNodeIds = [...payload.matchAll(/\[node:([^\]]+)\]/g)]
    .map(match => match[1])
    .filter(id => allowedIds.has(id))

  const warnings: string[] = []
  const invalidRefs = [...payload.matchAll(/\[node:([^\]]+)\]/g)]
    .map(match => match[1])
    .filter(id => !allowedIds.has(id))
  if (invalidRefs.length > 0) warnings.push(`Removed unsupported node references: ${[...new Set(invalidRefs)].join(', ')}`)

  const usableIds = new Set([...usedNodeIds, ...referencedNodeIds].filter(id => allowedIds.has(id)))
  if (nodes.length > 0 && usableIds.size === 0) warnings.push('Assembly output did not cite supplied node ids.')

  const unsupportedSignals = [
    /\b(series\s+[A-Z]|revenue|customers?|users?|downloads?|funding|launched|founded)\b/i,
    /\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:users|customers|downloads|followers|revenue|ARR|MRR|dollars|USD)\b/i,
  ]
  const supportText = nodes.map(node => `${node.title} ${node.summary || ''} ${node.content}`).join('\n').toLowerCase()
  for (const signal of unsupportedSignals) {
    const match = payload.match(signal)
    if (match && !supportText.includes(match[0].toLowerCase())) {
      warnings.push(`Possible unsupported claim: "${match[0]}"`)
    }
  }

  return { ok: warnings.length === 0, warnings, referencedNodeIds }
}

function preferredNodes(nodes: MemoryNode[]): MemoryNode[] {
  const weight: Record<string, number> = {
    project: 10,
    decision: 9,
    style: 8,
    preference: 8,
    person: 6,
    document: 4,
    note: 4,
    code: 3,
    conversation: 2,
    entity: 1,
  }
  return [...nodes].sort((a, b) =>
    (weight[b.type] || 0) - (weight[a.type] || 0) ||
    (b.confidence || 0) - (a.confidence || 0) ||
    b.timestamp - a.timestamp
  )
}

function appendSection(lines: string[], byType: Map<string, MemoryNode[]>, types: string[], limit: number, fallbackTypes: string[] = []): void {
  let nodes = types.flatMap(type => byType.get(type) || []).slice(0, limit)
  if (nodes.length === 0 && fallbackTypes.length > 0) {
    nodes = fallbackTypes.flatMap(type => byType.get(type) || []).slice(0, limit)
  }
  if (nodes.length === 0) {
    lines.push('- No reliable memory yet.')
    return
  }
  for (const node of nodes) {
    lines.push(`- ${summarizeNode(node)} [node:${node.id}]`)
  }
}

function appendSources(lines: string[], nodes: MemoryNode[]): void {
  const seen = new Set<string>()
  for (const node of nodes) {
    const key = `${node.sourceName}:${node.sourceType}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`- ${node.sourceName} (${node.sourceType}) [node:${node.id}]`)
    if (seen.size >= 6) break
  }
  if (seen.size === 0) lines.push('- No reliable sources yet.')
}

function summarizeNode(node: MemoryNode): string {
  const text = (node.summary || node.content || node.title).replace(/\s+/g, ' ').trim()
  const prefix = node.title && !text.toLowerCase().startsWith(node.title.toLowerCase())
    ? `${node.title}: `
    : ''
  return `${prefix}${text}`.slice(0, 260)
}

function clampMaxWords(maxWords?: number): number {
  if (!Number.isFinite(maxWords)) return DEFAULT_ASSEMBLY_MAX_WORDS
  return Math.max(120, Math.min(2000, Number(maxWords)))
}

function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const text = fenced ? fenced[1] : raw
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function repairJson(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
}
