import axios, { AxiosInstance } from 'axios'

interface OllamaGenerateResponse {
  response: string
  done: boolean
}

interface OllamaEmbedResponse {
  embedding: number[]
}

interface OllamaModel {
  name: string
  modified_at: string
  size: number
}

export class OllamaService {
  private client: AxiosInstance
  private baseUrl: string
  private model: string
  private embeddingModel: string
  private enrichmentController: AbortController | null = null

  // Called when a user query starts — aborts any in-progress enrichment Ollama call
  abortEnrichment(): void {
    this.enrichmentController?.abort()
    this.enrichmentController = null
  }

  // Used by enrichment calls so they can be cancelled mid-flight
  startEnrichmentCall(): AbortSignal {
    this.enrichmentController = new AbortController()
    return this.enrichmentController.signal
  }

  constructor(
    baseUrl = 'http://localhost:11434',
    model = 'gemma4:e4b',
    embeddingModel = 'nomic-embed-text'
  ) {
    this.baseUrl = baseUrl
    this.model = model
    this.embeddingModel = embeddingModel
    this.client = axios.create({ baseURL: baseUrl, timeout: 300000 })
  }

  updateConfig(baseUrl: string, model: string, embeddingModel: string): void {
    this.baseUrl = baseUrl
    this.model = model
    this.embeddingModel = embeddingModel
    this.client = axios.create({ baseURL: baseUrl, timeout: 300000 })
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.client.get('/api/version', { timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await this.client.get('/api/tags')
      return res.data.models || []
    } catch {
      return []
    }
  }

  // Strip Gemma 4 thinking tokens, leading dashes, and clean whitespace
  private clean(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\|[\s\S]*?\|>/g, '')
      .replace(/^[\s\-#]+/, '')   // strip leading ---, ###, whitespace
      .trim()
  }

  private async generate(prompt: string, timeoutMs = 120000, signal?: AbortSignal): Promise<string> {
    try {
      const res = await this.client.post<OllamaGenerateResponse>('/api/generate', {
        model: this.model,
        prompt,
        stream: false,
      }, { timeout: timeoutMs, signal })
      return this.clean(res.data.response || '')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string; code?: string }
      const status = axiosErr?.response?.status
      const body = axiosErr?.response?.data

      let ollamaMsg = ''
      if (body && typeof body === 'object') {
        ollamaMsg = (body as { error?: string }).error || JSON.stringify(body)
      }

      // Aborted (enrichment cancelled for a user query) — silent
      if (axiosErr?.code === 'ERR_CANCELED' || axiosErr?.message?.includes('canceled')) {
        throw new Error('enrichment_aborted')
      }

      // Timeout — give a clear actionable message
      if (axiosErr?.code === 'ECONNABORTED' || axiosErr?.message?.includes('timeout')) {
        throw new Error(`Ollama timed out after ${timeoutMs / 1000}s — try a shorter question, or check that Ollama isn't overloaded`)
      }

      // On 500: retry once with a much shorter prompt
      if (status === 500) {
        console.warn('[Ollama] 500 on full prompt, retrying short. Ollama said:', ollamaMsg)
        const shortPrompt = prompt.length > 500
          ? prompt.substring(0, 500) + '\n\nAnswer briefly:'
          : prompt
        try {
          const retry = await this.client.post<OllamaGenerateResponse>('/api/generate', {
            model: this.model, prompt: shortPrompt, stream: false,
          }, { timeout: timeoutMs })
          return this.clean(retry.data.response || '')
        } catch (retryErr: unknown) {
          const rb = (retryErr as { response?: { data?: unknown } })?.response?.data
          const rbMsg = rb && typeof rb === 'object' ? (rb as { error?: string }).error || '' : ''
          throw new Error(`Ollama 500: ${rbMsg || ollamaMsg || 'model error — check ollama logs'}`)
        }
      }

      throw new Error(`Ollama ${status || 'network'} error: ${ollamaMsg || axiosErr?.message || 'unknown'}`)
    }
  }

  async embed(text: string): Promise<number[]> {
    try {
      const res = await this.client.post<OllamaEmbedResponse>('/api/embeddings', {
        model: this.embeddingModel,
        prompt: text.substring(0, 512),
      })
      return res.data.embedding || []
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        // Embedding model not installed — use deterministic fallback silently
        // Pull it with: ollama pull nomic-embed-text
      } else {
        console.warn('[Ollama] Embed failed, using fallback:', status)
      }
      return this.fastEmbed(text)
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    for (const text of texts) {
      results.push(await this.embed(text))
      await new Promise(r => setTimeout(r, 10))
    }
    return results
  }

  async queryWithContext(
    userQuery: string,
    contextChunks: Array<{ content: string; source: string; timestamp: number; sourceType?: string }>,
    importLines: string[] = [],
    sourceMeta = '',
    decisionChain: string[] = [],
    conflicts: string[] = []
  ): Promise<{
    answer: string
    reasoning: string
    citations: Array<{ index: number; title: string; sourceName: string }>
    detectedConflicts: string[]
  }> {
    const chunks = contextChunks.slice(0, 4)

    // ── Build structured prompt ───────────────────────────────────────────────
    let prompt = `You are a personal AI assistant. Answer using ONLY the sources below.\n`
    prompt += `Rules: cite sources as [1][2] etc. If two sources disagree, write "⚠️ Conflict: ..." and explain both sides.\n\n`

    // Labeled, typed sources
    if (chunks.length > 0) {
      prompt += `Sources:\n`
      chunks.forEach((c, i) => {
        const typeLabel = c.sourceType === 'code' ? 'code' : c.sourceType === 'conversation' ? 'chat' : 'doc'
        prompt += `[${i + 1}] ${c.source} (${typeLabel})\n${c.content.substring(0, 220)}\n\n`
      })
    }

    // Decision history from timeline
    if (decisionChain.length > 0) {
      prompt += `Decision history:\n${decisionChain.slice(0, 4).map(d => `• ${d}`).join('\n')}\n\n`
    }

    // Known conflicts to surface
    if (conflicts.length > 0) {
      prompt += `Note — potential conflicts detected: ${conflicts.slice(0, 2).join('; ')}\n\n`
    }

    // Library context for stack questions
    if (importLines.length > 0) {
      prompt += `Libraries: ${importLines.slice(0, 6).join(', ')}\n\n`
    }

    prompt += `Question: ${userQuery}\nAnswer (with [N] citations):`

    // ── Generate ──────────────────────────────────────────────────────────────
    let answer = ''
    try {
      answer = await this.generate(prompt, 180000)
    } catch (err) {
      throw new Error(`Ollama failed: ${err instanceof Error ? err.message : 'Unknown'}`)
    }

    // ── Fallbacks ─────────────────────────────────────────────────────────────
    if (!answer || answer.length < 8) {
      const isStackQuestion = /stack|technolog|framework|language|library|built with/i.test(userQuery)
      if (isStackQuestion && importLines.length > 0) {
        answer = this.buildStackAnswer(importLines)
      } else if (chunks.length > 0) {
        answer = `Here's what I found:\n\n` +
          chunks.slice(0, 2).map((c, i) => `**[${i + 1}] ${c.source}**\n${c.content.substring(0, 200)}`).join('\n\n')
      } else {
        answer = `Nothing found matching "${userQuery}". Try syncing your sources first.`
      }
    }

    // ── Parse inline citations [N] from answer ────────────────────────────────
    const citationSet = new Set<number>()
    const citationRe = /\[(\d+)\]/g
    let m: RegExpExecArray | null
    while ((m = citationRe.exec(answer)) !== null) {
      const idx = parseInt(m[1])
      if (idx >= 1 && idx <= chunks.length) citationSet.add(idx)
    }
    const citations = [...citationSet].map(idx => {
      const chunk = chunks[idx - 1]
      const parts = chunk.source.split(' — ')
      return { index: idx, title: parts[1] || parts[0], sourceName: parts[0] }
    })

    // ── Extract any conflict notes Gemma wrote ────────────────────────────────
    const detectedConflicts: string[] = []
    const conflictRe = /⚠️ Conflict:([^\n.]+)/gi
    while ((m = conflictRe.exec(answer)) !== null) {
      detectedConflicts.push(m[1].trim())
    }

    const reasoning = chunks.length > 0
      ? `Reasoned across ${chunks.length} source(s) from ${[...new Set(chunks.map(c => c.source.split(' — ')[0]))].join(', ')}.${decisionChain.length > 0 ? ` Referenced ${decisionChain.length} past decision(s).` : ''}`
      : 'No matching sources found in your knowledge base.'

    return { answer, reasoning, citations, detectedConflicts }
  }

  // Only called for stack-specific questions when Gemma returns empty
  private buildStackAnswer(imports: string[]): string {
    const all = imports.join(' ').toLowerCase()
    const found: string[] = []

    const checks: [RegExp, string][] = [
      [/\bflask\b/, 'Flask'], [/\bfastapi\b/, 'FastAPI'], [/\bdjango\b/, 'Django'],
      [/\bstreamlit\b/, 'Streamlit'], [/\bgradio\b/, 'Gradio'],
      [/\breact\b/, 'React'], [/\bnext\b/, 'Next.js'], [/\bexpress\b/, 'Express'],
      [/\bvue\b/, 'Vue'],
      [/\bopenai\b/, 'OpenAI API'], [/\banthropic\b/, 'Anthropic API'],
      [/\blangchain\b/, 'LangChain'], [/\btransformers\b/, 'HuggingFace'],
      [/\btorch\b|\bpytorch\b/, 'PyTorch'], [/\btensorflow\b/, 'TensorFlow'],
      [/\bsqlite\b/, 'SQLite'], [/\bpostgres\b|\bpsycopg\b/, 'PostgreSQL'],
      [/\bmongodb\b|\bpymongo\b/, 'MongoDB'], [/\bredis\b/, 'Redis'],
      [/\brequests\b/, 'requests'], [/\baiohttp\b/, 'aiohttp'],
      [/\bselenium\b/, 'Selenium'], [/\bplaywright\b/, 'Playwright'],
      [/\bbs4\b|\bbeautifulsoup\b/, 'BeautifulSoup'],
      [/\bpandas\b/, 'Pandas'], [/\bnumpy\b/, 'NumPy'],
      [/\bprisma\b/, 'Prisma'], [/\bdrizzle\b/, 'Drizzle'],
      [/\bsupbase\b/, 'Supabase'], [/\bfirebase\b/, 'Firebase'],
    ]

    for (const [re, name] of checks) {
      if (re.test(all)) found.push(name)
    }

    const isPython = imports.some(l => /^(import |from )/.test(l))
    const isTS = imports.some(l => /typescript|\.ts['"]/.test(l))
    const isJS = imports.some(l => /require\(|from ['"]/.test(l)) && !isPython

    const langs = [...(isPython ? ['Python'] : []), ...(isTS ? ['TypeScript'] : []), ...(isJS ? ['JavaScript'] : [])]

    if (langs.length === 0 && found.length === 0) {
      return `Found ${imports.length} import(s) but couldn't identify specific technologies:\n${imports.slice(0, 8).join('\n')}`
    }

    return [
      langs.length > 0 ? `Language: ${langs.join(', ')}` : '',
      found.length > 0 ? `Libraries: ${found.join(', ')}` : '',
      `\nDetected from ${imports.length} import statement(s) in your indexed files.`
    ].filter(Boolean).join('\n')
  }

  async extractEntities(text: string): Promise<Array<{ name: string; type: string }>> {
    // Always get regex hits first — fast and reliable
    const regexHits = this.simpleEntityExtract(text)

    try {
      const prompt = `List the named entities in this text as a JSON array. Max 8 items.
Types: technology, person, project, concept, tool, organization
Format: [{"name":"X","type":"Y"}]
Only include clearly named things, not generic words.

Text: ${text.substring(0, 600)}

JSON:`

      const response = await this.generate(prompt, 30000, this.enrichmentController?.signal)
      const match = response.match(/\[[\s\S]*?\]/)
      if (!match) return regexHits

      const parsed = JSON.parse(match[0]) as Array<{ name?: string; type?: string }>
      if (!Array.isArray(parsed)) return regexHits

      const aiHits = parsed
        .filter(e => e.name && e.type)
        .map(e => ({ name: String(e.name).trim(), type: String(e.type).trim() }))
        .slice(0, 8)

      // Merge AI + regex results, deduplicate by name (case-insensitive)
      const seen = new Set(aiHits.map(e => e.name.toLowerCase()))
      for (const r of regexHits) {
        if (!seen.has(r.name.toLowerCase())) {
          aiHits.push(r)
          seen.add(r.name.toLowerCase())
        }
      }

      return aiHits.slice(0, 10)
    } catch {
      return regexHits
    }
  }

  async summarize(text: string, maxLength = 150): Promise<string> {
    // Only summarize if content is long enough to be worth it
    if (text.length < 300) return text.substring(0, maxLength)

    try {
      const prompt = `Summarize the following in one sentence of max ${maxLength} characters. Be specific — mention key technologies, decisions, or topics. No filler words.

Text: ${text.substring(0, 1200)}

One-sentence summary:`

      const result = await this.generate(prompt, 30000, this.enrichmentController?.signal)
      const firstSentence = result.split(/[.\n]/)[0]?.trim() || result
      return firstSentence.substring(0, maxLength)
    } catch {
      return text.substring(0, maxLength)
    }
  }

  async extractDecision(text: string): Promise<{
    isDecision: boolean
    decision?: string
    reasoning?: string
    alternatives?: string[]
  }> {
    // Quick heuristic first — skip if content doesn't look like it has a decision
    const decisionSignals = /\b(decided|chose|rejected|switched|picked|went with|instead of|rather than|because|reason|alternative|option|vs|versus|tradeoff|trade-off)\b/i
    if (!decisionSignals.test(text)) return { isDecision: false }

    try {
      const prompt = `Does this text contain a technical or architectural decision? Answer with JSON only.

Rules:
- "isDecision": true only if someone explicitly chose one thing over another
- "decision": the choice made (max 80 chars)
- "reasoning": why they chose it (max 120 chars)
- "alternatives": array of rejected options (max 3)

Text: ${text.substring(0, 800)}

JSON response:`

      const response = await this.generate(prompt, 30000, this.enrichmentController?.signal)

      // Extract JSON from response — Gemma sometimes wraps it in markdown
      const match = response.match(/\{[\s\S]*?\}/)
      if (!match) return { isDecision: false }

      const parsed = JSON.parse(match[0]) as {
        isDecision?: boolean
        decision?: string
        reasoning?: string
        alternatives?: string[]
      }

      if (!parsed.isDecision || !parsed.decision) return { isDecision: false }

      return {
        isDecision: true,
        decision: parsed.decision?.substring(0, 80),
        reasoning: parsed.reasoning?.substring(0, 120),
        alternatives: Array.isArray(parsed.alternatives)
          ? parsed.alternatives.slice(0, 3).map(a => String(a).substring(0, 60))
          : [],
      }
    } catch {
      return { isDecision: false }
    }
  }

  fastEmbed(text: string): number[] {
    const dims = 64
    const embedding = new Array(dims).fill(0)
    const words = text.toLowerCase().split(/\s+/)
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      for (let j = 0; j < word.length; j++) {
        embedding[(i + j) % dims] += word.charCodeAt(j) / 255
      }
    }
    const magnitude = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1
    return embedding.map(v => v / magnitude)
  }

  simpleEntityExtract(text: string): Array<{ name: string; type: string }> {
    const tech = ['react','node','typescript','python','postgres','redis','docker',
      'kubernetes','aws','gcp','firebase','supabase','graphql','mongodb',
      'elasticsearch','nginx','express','fastapi','prisma','sqlite',
      'flask','django','streamlit','openai','anthropic','langchain']
    const entities: Array<{ name: string; type: string }> = []
    const lower = text.toLowerCase()
    for (const t of tech) {
      if (lower.includes(t))
        entities.push({ name: t.charAt(0).toUpperCase() + t.slice(1), type: 'technology' })
    }
    return entities.slice(0, 8)
  }
}
