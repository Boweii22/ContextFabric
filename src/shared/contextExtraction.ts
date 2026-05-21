export const CONTEXT_NODE_TYPES = ['project', 'style', 'decision', 'preference', 'person'] as const

export type ContextNodeType = typeof CONTEXT_NODE_TYPES[number]

export interface ExtractedContextNode {
  type: ContextNodeType
  title: string
  summary: string
  confidence: number
  evidence: string
  entities: string[]
  tags: string[]
  metadata: {
    reasoning?: string
    alternatives?: string[]
    reversible?: boolean
    preferenceCategory?: string
    personRole?: string
    sourceInputType?: string
  }
}

export interface ContextExtractionResult {
  nodes: ExtractedContextNode[]
}

export interface ContextExtractionParseResult {
  ok: boolean
  result: ContextExtractionResult
  errors: string[]
}

export const CONTEXT_EXTRACTION_SYSTEM_PROMPT = `You are ContextFabric's local Gemma 4 context extractor.

Your job is to read one piece of user-owned context and output ONLY valid JSON.
No markdown. No prose. No comments. No trailing commas.

Extract durable context nodes that another AI assistant should remember later.
Use only facts supported by the input. Do not invent people, projects, tools, or decisions.

Allowed node types:
- project: what the user is building, maintaining, researching, or planning.
- style: how the user writes, communicates, designs, codes, or prefers answers to be shaped.
- decision: a choice already made, including why, tradeoffs, rejected alternatives, or reversibility.
- preference: a stable working preference, constraint, tool choice, privacy preference, format preference, or habit.
- person: a collaborator, stakeholder, user, client, author, or named human with relevant relationship/role context.

Return this exact JSON shape:
{
  "nodes": [
    {
      "type": "project" | "style" | "decision" | "preference" | "person",
      "title": "short human-readable title",
      "summary": "one factual sentence, max 220 characters",
      "confidence": 0.0,
      "evidence": "short direct evidence phrase from the input, max 180 characters",
      "entities": ["important names, tools, projects, people"],
      "tags": ["lowercase-keywords"],
      "metadata": {
        "reasoning": "why this node matters, if available",
        "alternatives": ["rejected option"],
        "reversible": true,
        "preferenceCategory": "format|tooling|privacy|workflow|code|communication|design",
        "personRole": "role or relationship",
        "sourceInputType": "conversation|notes|code_comments|bullet_points|prose"
      }
    }
  ]
}

Rules:
- Use confidence from 0.0 to 1.0.
- Use confidence >= 0.85 only when the input states the fact clearly.
- Use confidence 0.55-0.84 for reasonable but still direct inference.
- Drop weak guesses below 0.55.
- Return at most 6 nodes.
- If no durable context exists, return {"nodes":[]}.`

export function buildContextExtractionPrompt(text: string, inputType = 'unknown'): string {
  return `${CONTEXT_EXTRACTION_SYSTEM_PROMPT}

Input type: ${inputType}

Text:
${text.slice(0, 1800)}

JSON:`
}

export function parseContextExtraction(raw: string): ContextExtractionParseResult {
  const errors: string[] = []
  const parsed = parseJsonObject(raw)

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, result: { nodes: [] }, errors: ['Output is not a JSON object.'] }
  }

  const root = parsed as Record<string, unknown>
  if (!Array.isArray(root.nodes)) {
    return { ok: false, result: { nodes: [] }, errors: ['Missing nodes array.'] }
  }

  const nodes: ExtractedContextNode[] = []
  for (const [index, value] of root.nodes.entries()) {
    const node = normalizeNode(value, index, errors)
    if (node) nodes.push(node)
  }

  return { ok: errors.length === 0, result: { nodes: nodes.slice(0, 6) }, errors }
}

export function repairContextExtraction(raw: string): string {
  return raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim()
}

function parseJsonObject(raw: string): unknown {
  const repaired = repairContextExtraction(raw)
  try {
    return JSON.parse(repaired)
  } catch {
    const objectText = extractFirstObject(repaired)
    if (!objectText) return null
    try { return JSON.parse(objectText) } catch { return null }
  }
}

function extractFirstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (depth === 0) return text.slice(start, i + 1)
  }

  return null
}

function normalizeNode(value: unknown, index: number, errors: string[]): ExtractedContextNode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`Node ${index} is not an object.`)
    return null
  }

  const node = value as Record<string, unknown>
  const type = String(node.type || '').trim() as ContextNodeType
  if (!CONTEXT_NODE_TYPES.includes(type)) {
    errors.push(`Node ${index} has invalid type "${String(node.type || '')}".`)
    return null
  }

  const title = cleanString(node.title, 90)
  const summary = cleanString(node.summary, 240)
  const evidence = cleanString(node.evidence, 200)
  const confidence = clampConfidence(node.confidence)

  if (!title) errors.push(`Node ${index} is missing title.`)
  if (!summary) errors.push(`Node ${index} is missing summary.`)
  if (!evidence) errors.push(`Node ${index} is missing evidence.`)
  if (confidence < 0.55) return null
  if (!title || !summary || !evidence) return null

  return {
    type,
    title,
    summary,
    evidence,
    confidence,
    entities: cleanStringArray(node.entities, 8, 64),
    tags: cleanStringArray(node.tags, 8, 32).map(tag => tag.toLowerCase().replace(/\s+/g, '-')),
    metadata: normalizeMetadata(node.metadata),
  }
}

function normalizeMetadata(value: unknown): ExtractedContextNode['metadata'] {
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  const result: ExtractedContextNode['metadata'] = {}
  const reasoning = cleanString(metadata.reasoning, 180)
  const preferenceCategory = cleanString(metadata.preferenceCategory, 40)
  const personRole = cleanString(metadata.personRole, 80)
  const sourceInputType = cleanString(metadata.sourceInputType, 40)

  if (reasoning) result.reasoning = reasoning
  const alternatives = cleanStringArray(metadata.alternatives, 4, 80)
  if (alternatives.length) result.alternatives = alternatives
  if (typeof metadata.reversible === 'boolean') result.reversible = metadata.reversible
  if (preferenceCategory) result.preferenceCategory = preferenceCategory
  if (personRole) result.personRole = personRole
  if (sourceInputType) result.sourceInputType = sourceInputType

  return result
}

function cleanString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanStringArray(value: unknown, limit: number, max: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of value) {
    const text = cleanString(item, max)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }

  return result
}

function clampConfidence(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(1, number))
}
