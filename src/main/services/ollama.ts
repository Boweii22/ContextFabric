import axios, { AxiosInstance } from 'axios'
import {
  buildContextExtractionPrompt,
  parseContextExtraction,
  type ContextExtractionResult,
} from '../../shared/contextExtraction'
import { buildConflictDetectionPrompt, parseConflictDetection } from '../../shared/conflictDetection'
import type { MemoryConflict, MemoryNode } from '../../shared/types'

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
  private constrainedModelReady = false
  private readonly constrainedModelName = 'cf-gemma4'
  private readonly runtimeContext = 128
  private geminiApiKey = ''
  private geminiModel = 'gemma-3-27b-it'

  setGeminiKey(apiKey: string, model?: string): void {
    this.geminiApiKey = apiKey.trim()
    if (model?.trim()) this.geminiModel = model.trim()
  }

  abortEnrichment(): void {
    this.enrichmentController?.abort()
    this.enrichmentController = null
  }

  startEnrichmentCall(): AbortSignal {
    this.enrichmentController = new AbortController()
    return this.enrichmentController.signal
  }

  constructor(
    baseUrl = 'http://localhost:11434',
    model = 'cf-gemma4',
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
    this.constrainedModelReady = false
    this.client = axios.create({ baseURL: baseUrl, timeout: 300000 })
    this.ensureConstrainedModel().catch(() => {})
  }

  // Creates a memory-limited Ollama model variant at startup.
  // This pre-allocates only ~100 MB of KV cache instead of several GB,
  // which is what causes "memory layout cannot be allocated" on 16 GB machines.
  async ensureConstrainedModel(): Promise<void> {
    if (this.constrainedModelReady) return
    const models = await this.listModels()
    const modelNames = models.map(m => m.name)
    if (modelNames.some(name => name === this.constrainedModelName || name === `${this.constrainedModelName}:latest`)) {
      this.model = this.constrainedModelName
      this.constrainedModelReady = true
      return
    }

    const sourceModel = this.model === this.constrainedModelName
      ? modelNames.find(name => /gemma4|gemma3/i.test(name) && !name.startsWith(this.constrainedModelName))
      : this.model
    if (!sourceModel || !/gemma4|gemma3/i.test(sourceModel)) return

    try {
      console.log(`[Ollama] Creating memory-constrained model ${this.constrainedModelName} (num_ctx=${this.runtimeContext}) from ${sourceModel}...`)
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 30000)

      const res = await fetch(`${this.baseUrl}/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.constrainedModelName,
          from: sourceModel,
          parameters: {
            num_ctx: this.runtimeContext,
            num_predict: 64,
            num_batch: 4,
          },
          stream: false,
        }),
        signal: ctrl.signal,
      })
      clearTimeout(tid)
      const responseBody = await res.text()

      if (res.ok) {
        this.model = this.constrainedModelName
        this.constrainedModelReady = true
        console.log(`[Ollama] Ready: using ${this.constrainedModelName} (num_ctx=${this.runtimeContext}, low-memory)`)
      } else {
        console.warn(`[Ollama] Model creation failed (HTTP ${res.status}): ${responseBody.substring(0, 300)}`)
        console.warn('[Ollama] Falling back to original model â€” OOM errors may occur')
      }
    } catch (err) {
      console.warn('[Ollama] Could not create constrained model:', err instanceof Error ? err.message : err)
    }
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

  private lowMemoryOptions(numPredict = 192): Record<string, number> {
    return {
      num_ctx: this.runtimeContext,
      num_predict: numPredict,
      num_batch: 4,
    }
  }

  private extractOllamaError(body: unknown): string {
    if (!body) return ''
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body) as { error?: string }
        return parsed.error || body
      } catch {
        return body
      }
    }
    if (typeof body === 'object') {
      return (body as { error?: string }).error || JSON.stringify(body)
    }
    return String(body)
  }

  private isMemoryLayoutError(message: string): boolean {
    return /memory layout cannot be allocated|out of memory|not enough memory/i.test(message)
  }

  private async unloadModel(model = this.model): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 }),
      })
    } catch {
      // Best effort only. Ollama may already have unloaded the model.
    }
  }

  private async generate(
    prompt: string,
    timeoutMs = 120000,
    signal?: AbortSignal,
    numPredict?: number
  ): Promise<string> {
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        prompt,
        stream: false,
        keep_alive: '0s',
        options: this.lowMemoryOptions(numPredict ?? 192),
      }

      const res = await this.client.post<OllamaGenerateResponse>('/api/generate', body, { timeout: timeoutMs, signal })
      const raw = res.data.response || ''
      console.log('[Ollama] raw response length:', raw.length, '| first 120:', raw.substring(0, 120).replace(/\n/g, ' '))
      return this.clean(raw)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string; code?: string }
      const status = axiosErr?.response?.status
      const body = axiosErr?.response?.data

      const ollamaMsg = this.extractOllamaError(body)

      // Aborted (enrichment cancelled for a user query) â€” silent
      if (axiosErr?.code === 'ERR_CANCELED' || axiosErr?.message?.includes('canceled')) {
        throw new Error('enrichment_aborted')
      }

      // Timeout â€” give a clear actionable message
      if (axiosErr?.code === 'ECONNABORTED' || axiosErr?.message?.includes('timeout')) {
        throw new Error(`Ollama timed out after ${timeoutMs / 1000}s â€” try a shorter question, or check that Ollama isn't overloaded`)
      }

      // On 500: retry once with a much shorter prompt
      if (status === 500) {
        if (this.isMemoryLayoutError(ollamaMsg)) await this.unloadModel()
        console.warn('[Ollama] 500 on full prompt, retrying short. Ollama said:', ollamaMsg)
        const shortPrompt = prompt.length > 500
          ? prompt.substring(0, 500) + '\n\nAnswer briefly:'
          : prompt
        try {
          const retry = await this.client.post<OllamaGenerateResponse>('/api/generate', {
            model: this.model, prompt: shortPrompt, stream: false,
            keep_alive: '0s', options: this.lowMemoryOptions(96),
          }, { timeout: timeoutMs })
          return this.clean(retry.data.response || '')
        } catch (retryErr: unknown) {
          const rb = (retryErr as { response?: { data?: unknown } })?.response?.data
          const rbMsg = this.extractOllamaError(rb)
          if (this.isMemoryLayoutError(rbMsg || ollamaMsg)) await this.unloadModel()
          throw new Error(`Ollama 500: ${rbMsg || ollamaMsg || 'model error â€” check ollama logs'}`)
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
        // Embedding model not installed â€” use deterministic fallback silently
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


  // Google AI Studio streaming â€” automatic fallback when local Ollama has OOM errors
  private async generateWithGemini(prompt: string, onChunk: (text: string) => void): Promise<string> {
    if (!this.geminiApiKey) throw new Error('No Gemini API key configured')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:streamGenerateContent?key=${this.geminiApiKey}&alt=sse`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`)
    }
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const event of events) {
          const line = event.replace(/^data:\s*/, '').trim()
          if (!line || line === '[DONE]') continue
          try {
            const data = JSON.parse(line) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
            if (text) { fullText += text; onChunk(text) }
          } catch { /* ignore */ }
        }
      }
    } finally {
      try { reader.releaseLock() } catch { /* ignore */ }
    }
    return this.clean(fullText)
  }

  // Streaming generate â€” calls onChunk for each visible token, filters <think> blocks live
  private async generateStream(
    prompt: string,
    onChunk: (text: string) => void,
    numPredict?: number,
    signal?: AbortSignal
  ): Promise<string> {
    console.log(`[Ollama] generateStream using model: ${this.model}`)
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: true,
      keep_alive: '0s',
      options: this.lowMemoryOptions(numPredict ?? 192),
    }
    const controller = new AbortController()
    if (signal) signal.addEventListener('abort', () => controller.abort())
    const timeoutId = setTimeout(() => controller.abort(), 300000)

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeoutId)
      const msg = err instanceof Error ? err.message : 'fetch failed'
      if (msg.includes('abort') || msg.includes('cancel')) throw new Error('enrichment_aborted')
      throw new Error(`Ollama connect failed: ${msg}`)
    }

    if (!res.ok) {
      clearTimeout(timeoutId)
      const errText = await res.text()
      const msg = this.extractOllamaError(errText)
      if (this.isMemoryLayoutError(msg)) await this.unloadModel()
      throw new Error(`Ollama ${res.status}: ${msg || errText}`)
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    let inThink = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line) as { response?: string; done?: boolean; error?: string }
            if (data.error) throw new Error(data.error)
            if (data.response) {
              fullText += data.response
              const tok = data.response
              if (!inThink) {
                if (tok.includes('<think>')) {
                  inThink = true
                  const before = tok.split('<think>')[0]
                  if (before) onChunk(before)
                } else {
                  onChunk(tok)
                }
              } else {
                if (tok.includes('</think>')) {
                  inThink = false
                  const after = tok.split('</think>').slice(1).join('')
                  if (after) onChunk(after)
                }
              }
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && !parseErr.message.includes('JSON')) throw parseErr
          }
        }
      }
    } finally {
      clearTimeout(timeoutId)
      try { reader.releaseLock() } catch { /* already released */ }
    }

    return this.clean(fullText)
  }

  async queryWithContext(
    userQuery: string,
    contextChunks: Array<{ content: string; source: string; timestamp: number; sourceType?: string }>,
    importLines: string[] = [],
    sourceMeta = '',
    decisionChain: string[] = [],
    conflicts: string[] = [],
    onChunk?: (text: string) => void
  ): Promise<{
    answer: string
    reasoning: string
    citations: Array<{ index: number; title: string; sourceName: string }>
    detectedConflicts: string[]
  }> {
    await this.ensureConstrainedModel()
    const chunks = contextChunks.slice(0, 4)

    let prompt = `Answer the question in 3-5 clear sentences using only the facts below. Do not paste raw excerpts. Explain what the project is, who it is for, and what it does. No thinking.\n\n`

    if (chunks.length > 0) {
      chunks.forEach((c, i) => {
        const title = c.source.includes('—') ? c.source.split('—').slice(1).join('—').trim() : c.source
        prompt += `[${i + 1}] ${title}:\n${c.content.substring(0, 900).replace(/\n{3,}/g, '\n\n')}\n\n`
      })
      prompt += '\n'
    }

    if (importLines.length > 0) {
      prompt += `Libraries: ${importLines.slice(0, 4).join(', ')}\n\n`
    }

    if (decisionChain.length > 0) {
      prompt += `Key decisions: ${decisionChain.slice(0, 2).join(' | ')}\n\n`
    }

    prompt += `Q: ${userQuery}\nA:`

    // â”€â”€ Generate (streaming) â€” falls back to Gemini API on OOM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let answer = ''
    try {
      answer = await this.generateStream(prompt, onChunk ?? (() => {}), 160)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown'
      const isOom = /memory layout|cannot be allocated|model failed to load|requires more system memory/i.test(errMsg)
      if (isOom) {
        throw new Error(`Gemma 4 needs more free RAM to load. Close Chrome/VS Code/other apps, then retry. Ollama said: ${errMsg}`)
      }
      throw new Error(`Ollama failed: ${errMsg}`)
    }

    // Fallbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!answer || answer.length < 8) {
      const isStackQuestion = /stack|technolog|framework|language|library|built with/i.test(userQuery)
      if (isStackQuestion && importLines.length > 0) {
        answer = this.buildStackAnswer(importLines)
      } else if (chunks.length > 0) {
        answer = this.buildExtractiveAnswer(userQuery, chunks)
      } else {
        answer = `Nothing found matching "${userQuery}". Try syncing your sources first.`
      }
    }

    // â”€â”€ Parse inline citations [N] from answer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const citationSet = new Set<number>()
    const citationRe = /\[(\d+)\]/g
    let m: RegExpExecArray | null
    while ((m = citationRe.exec(answer)) !== null) {
      const idx = parseInt(m[1])
      if (idx >= 1 && idx <= chunks.length) citationSet.add(idx)
    }
    const citations = [...citationSet].map(idx => {
      const chunk = chunks[idx - 1]
      const parts = chunk.source.split(' â€” ')
      return { index: idx, title: parts[1] || parts[0], sourceName: parts[0] }
    })

    // â”€â”€ Extract any conflict notes Gemma wrote â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const detectedConflicts: string[] = []
    const conflictRe = /âš ï¸ Conflict:([^\n.]+)/gi
    while ((m = conflictRe.exec(answer)) !== null) {
      detectedConflicts.push(m[1].trim())
    }

    const reasoning = chunks.length > 0
      ? `Reasoned across ${chunks.length} source(s) from ${[...new Set(chunks.map(c => c.source.split(' â€” ')[0]))].join(', ')}.${decisionChain.length > 0 ? ` Referenced ${decisionChain.length} past decision(s).` : ''}`
      : 'No matching sources found in your knowledge base.'

    return { answer, reasoning, citations, detectedConflicts }
  }

  buildExtractiveAnswer(
    userQuery: string,
    chunks: Array<{ content: string; source: string; timestamp: number; sourceType?: string }>
  ): string {
    if (chunks.length === 0) return `Nothing found matching "${userQuery}". Try syncing your sources first.`
    const text = chunks.map(c => c.content).join('\n\n')
    const title = this.extractProjectTitle(text) || 'This project'
    const sentences = this.extractUsefulSentences(text, userQuery)
    const phase = this.extractPhaseLine(text)
    const parts: string[] = []

    if (sentences.length > 0) {
      parts.push(`${title} is ${this.lowerFirst(sentences[0])}`)
      parts.push(...sentences.slice(1, 4))
    } else {
      parts.push(`${title} is described in your indexed project notes, but the available chunks are too fragmentary for a detailed summary.`)
    }
    if (phase) parts.push(`Current roadmap/status: ${phase}.`)
    parts.push(`Source: ${chunks[0].source}.`)
    return parts.join(' ')
  }

  private extractProjectTitle(text: string): string | null {
    const heading = text.match(/^#\s+(.+?)(?:\s+[-—]\s+|$)/m)
    if (heading?.[1]) return heading[1].trim()
    const named = text.match(/\b([A-Z][A-Za-z0-9]+Match)\b/)
    return named?.[1] || null
  }

  private extractUsefulSentences(text: string, query: string): string[] {
    const terms = query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3)
    const cleaned = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\|[-:\s|]+\|/g, ' ')
      .replace(/[#>*_`[\]]/g, '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim().replace(/\s+/g, ' '))
      .filter(s => s.length > 35 && s.length < 260)
      .filter(s => !/^\|/.test(s) && !/watch th|quick links/i.test(s))

    return cleaned
      .map(sentence => ({
        sentence,
        score: terms.reduce((sum, term) => sum + (sentence.toLowerCase().includes(term) ? 2 : 0), 0) +
          (/\b(local|clinical|trial|pdf|offline|patient|matching|languages|email)\b/i.test(sentence) ? 1 : 0),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.sentence)
      .slice(0, 4)
  }

  private extractPhaseLine(text: string): string | null {
    const match = text.match(/\|\s*v1\s*\(now\)\s*\|\s*([^|]+)\|/i)
    return match?.[1]?.trim() || null
  }

  private lowerFirst(text: string): string {
    return text ? text.charAt(0).toLowerCase() + text.slice(1) : text
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
    // Always get regex hits first â€” fast and reliable
    const regexHits = this.simpleEntityExtract(text)

    try {
      const prompt = `List the named entities in this text as a JSON array. Max 8 items.
Types: technology, person, project, concept, tool, organization
Format: [{"name":"X","type":"Y"}]
Only include clearly named things, not generic words.

Text: ${text.substring(0, 600)}

JSON:`

      const response = await this.generate(prompt, 30000, this.enrichmentController?.signal, 200)
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

  async extractContextNodes(text: string, inputType = 'unknown'): Promise<ContextExtractionResult> {
    const prompt = buildContextExtractionPrompt(text, inputType)
    const repairPrompt = (badOutput: string, errors: string[]) => `${prompt}

The previous output was invalid for this schema.
Errors:
${errors.map(error => `- ${error}`).join('\n')}

Previous output:
${badOutput.slice(0, 1200)}

Return corrected JSON only:`

    try {
      const first = await this.generate(prompt, 45000, this.enrichmentController?.signal, 360)
      const parsed = parseContextExtraction(first)
      if (parsed.ok) return parsed.result

      const second = await this.generate(repairPrompt(first, parsed.errors), 45000, this.enrichmentController?.signal, 320)
      const repaired = parseContextExtraction(second)
      if (repaired.result.nodes.length > 0) return repaired.result
      return { nodes: [] }
    } catch (error) {
      if (error instanceof Error && error.message === 'enrichment_aborted') throw error
      return { nodes: [] }
    }
  }

  async detectNodeConflict(existing: MemoryNode, incoming: MemoryNode): Promise<Omit<MemoryConflict, 'id' | 'existingNodeId' | 'newNodeId' | 'existingSummary' | 'newSummary' | 'status' | 'createdAt' | 'resolvedAt'> | null> {
    try {
      const response = await this.generate(buildConflictDetectionPrompt(existing, incoming), 30000, this.enrichmentController?.signal, 180)
      const parsed = parseConflictDetection(response)
      if (!parsed?.conflict && !parsed?.maybe) return null
      if ((parsed.confidence || 0) < 0.5 && !parsed.maybe) return null
      return {
        type: parsed.type,
        maybe: parsed.maybe,
        confidence: parsed.confidence,
        severity: parsed.severity,
        reason: parsed.reason || 'Gemma detected a possible memory conflict.',
        suggestedResolution: parsed.suggestedResolution,
      }
    } catch {
      return null
    }
  }

  async summarize(text: string, maxLength = 150): Promise<string> {
    // Only summarize if content is long enough to be worth it
    if (text.length < 300) return text.substring(0, maxLength)

    try {
      const prompt = `One sentence summary (max ${maxLength} chars), no thinking:\n${text.substring(0, 600)}\nSummary:`

      const result = await this.generate(prompt, 30000, this.enrichmentController?.signal, 100)
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
    // Quick heuristic first â€” skip if content doesn't look like it has a decision
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

      // Extract JSON from response â€” Gemma sometimes wraps it in markdown
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


