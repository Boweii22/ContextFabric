export type ConflictStatus = 'open' | 'accepted_new' | 'kept_existing' | 'kept_both' | 'dismissed'
export type ConflictSeverity = 'low' | 'medium' | 'high'

export interface MemoryConflict {
  id: string
  existingNodeId: string
  newNodeId: string
  type: 'contradiction' | 'tension' | 'duplicate'
  maybe: boolean
  confidence: number
  severity: ConflictSeverity
  reason: string
  existingSummary: string
  newSummary: string
  suggestedResolution: 'accept_new' | 'keep_existing' | 'keep_both' | 'review'
  status: ConflictStatus
  createdAt: number
  resolvedAt?: number
}

export const CONFLICT_DETECTION_PROMPT = `You are ContextFabric's local Gemma 4 conflict detector.

Compare one existing memory node with one new memory node.
Return ONLY valid JSON. No markdown, no prose.

A conflict exists when the two nodes cannot both be true as stable user context.
Examples:
- Existing preference says "prefer short answers"; new preference says "prefer detailed long answers".
- Existing decision says "use PostgreSQL"; new decision says "switched from PostgreSQL to SQLite".
- Existing style says "avoid emojis"; new style says "use emojis often".

Do not flag harmless additions, narrower details, or facts about different projects.

Return:
{
  "conflict": true,
  "maybe": false,
  "confidence": 0.0,
  "type": "contradiction" | "tension" | "duplicate",
  "severity": "low" | "medium" | "high",
  "reason": "short explanation",
  "suggestedResolution": "accept_new" | "keep_existing" | "keep_both" | "review"
}

Use "maybe": true when the wording is ambiguous or the conflict depends on project/time scope.
If no conflict exists, return {"conflict":false,"maybe":false,"confidence":0,"type":"tension","severity":"low","reason":"","suggestedResolution":"review"}.`

export function buildConflictDetectionPrompt(existing: { type: string; title: string; summary?: string; content: string }, incoming: { type: string; title: string; summary?: string; content: string }): string {
  return `${CONFLICT_DETECTION_PROMPT}

Existing node:
type=${existing.type}
title=${existing.title}
text=${(existing.summary || existing.content).slice(0, 800)}

New node:
type=${incoming.type}
title=${incoming.title}
text=${(incoming.summary || incoming.content).slice(0, 800)}

JSON:`
}

export function parseConflictDetection(raw: string): {
  conflict: boolean
  maybe: boolean
  confidence: number
  type: MemoryConflict['type']
  severity: ConflictSeverity
  reason: string
  suggestedResolution: MemoryConflict['suggestedResolution']
} | null {
  const text = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').replace(/,\s*([}\]])/g, '$1').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const type = ['contradiction', 'tension', 'duplicate'].includes(String(parsed.type)) ? parsed.type as MemoryConflict['type'] : 'tension'
    const severity = ['low', 'medium', 'high'].includes(String(parsed.severity)) ? parsed.severity as ConflictSeverity : 'low'
    const suggested = ['accept_new', 'keep_existing', 'keep_both', 'review'].includes(String(parsed.suggestedResolution))
      ? parsed.suggestedResolution as MemoryConflict['suggestedResolution']
      : 'review'
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    return {
      conflict: Boolean(parsed.conflict),
      maybe: Boolean(parsed.maybe),
      confidence,
      type,
      severity,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : '',
      suggestedResolution: suggested,
    }
  } catch {
    return null
  }
}
