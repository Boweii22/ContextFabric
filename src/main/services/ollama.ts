import axios, { AxiosInstance } from 'axios'

interface OllamaGenerateResponse {
  response: string
  done: boolean
  context?: number[]
  total_duration?: number
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

  constructor(
    baseUrl = 'http://localhost:11434',
    model = 'gemma4:e4b',
    embeddingModel = 'nomic-embed-text'
  ) {
    this.baseUrl = baseUrl
    this.model = model
    this.embeddingModel = embeddingModel
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 120000,
    })
  }

  updateConfig(baseUrl: string, model: string, embeddingModel: string): void {
    this.baseUrl = baseUrl
    this.model = model
    this.embeddingModel = embeddingModel
    this.client = axios.create({ baseURL: baseUrl, timeout: 120000 })
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

  async embed(text: string): Promise<number[]> {
    try {
      const res = await this.client.post<OllamaEmbedResponse>('/api/embeddings', {
        model: this.embeddingModel,
        prompt: text,
      })
      return res.data.embedding
    } catch (err) {
      console.error('[Ollama] Embed error:', err)
      return this.fallbackEmbed(text)
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

  async generate(prompt: string, system?: string, context?: number[]): Promise<string> {
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_ctx: 8192,
        },
      }
      if (system) body.system = system
      if (context) body.context = context

      const res = await this.client.post<OllamaGenerateResponse>('/api/generate', body)
      return res.data.response
    } catch (err) {
      console.error('[Ollama] Generate error:', err)
      throw new Error(`Ollama generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  async *generateStream(prompt: string, system?: string): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: true,
      options: { temperature: 0.3, top_p: 0.9, num_ctx: 8192 },
    }
    if (system) body.system = system

    const res = await this.client.post('/api/generate', body, {
      responseType: 'stream',
    })

    let buffer = ''
    for await (const chunk of res.data) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line) as OllamaGenerateResponse
          if (data.response) yield data.response
          if (data.done) return
        } catch {
          // skip malformed
        }
      }
    }
  }

  async queryWithContext(
    userQuery: string,
    contextChunks: Array<{ content: string; source: string; timestamp: number }>
  ): Promise<{ answer: string; reasoning: string }> {
    const contextText = contextChunks
      .slice(0, 12)
      .map((c, i) => `[Source ${i + 1} — ${c.source} — ${new Date(c.timestamp).toLocaleDateString()}]\n${c.content}`)
      .join('\n\n---\n\n')

    const system = `You are ContextFabric's AI reasoning engine. Your role is to answer questions about the user's personal knowledge, decisions, and history by analyzing their imported data.

You have access to the user's conversations, notes, code, and documents. Reason carefully across multiple sources. Be precise about WHEN things happened, WHY decisions were made, and HOW thinking evolved over time.

Always cite your sources using [Source N] notation. Be honest when information is unclear or contradictory. Focus on reconstructing the actual reasoning behind decisions, not just summarizing content.

Keep answers concise but complete. Lead with the direct answer, then provide supporting evidence.`

    const prompt = `USER QUESTION: ${userQuery}

RELEVANT CONTEXT FROM PERSONAL KNOWLEDGE BASE:
${contextText || 'No relevant context found in your knowledge base.'}

---
Answer the question based on the context above. If the context is insufficient, say so clearly. Cite sources using [Source N] notation. Format your response with:
1. Direct answer (1-3 sentences)
2. Supporting evidence with citations
3. Timeline context if relevant`

    const answer = await this.generate(prompt, system)

    const reasoningPrompt = `Based on this answer: "${answer.substring(0, 500)}"

In 2-3 sentences, explain the reasoning process: what patterns across the sources led to this conclusion, and what the confidence level is.`

    let reasoning = ''
    try {
      reasoning = await this.generate(reasoningPrompt)
    } catch {
      reasoning = 'Analysis based on semantic similarity and contextual relevance across indexed sources.'
    }

    return { answer, reasoning }
  }

  async extractEntities(text: string): Promise<Array<{ name: string; type: string }>> {
    const prompt = `Extract named entities from this text. Return ONLY a JSON array with objects having "name" and "type" fields.
Types can be: technology, person, project, concept, tool, organization.
Limit to 10 most important entities.
Text: "${text.substring(0, 2000)}"
Response (JSON only):`.trim()

    try {
      const response = await this.generate(prompt)
      const match = response.match(/\[[\s\S]*\]/)
      if (match) {
        const parsed = JSON.parse(match[0])
        return Array.isArray(parsed) ? parsed : []
      }
    } catch {
      // fallback: simple extraction
    }
    return this.simpleEntityExtract(text)
  }

  async summarize(text: string, maxLength = 200): Promise<string> {
    const prompt = `Summarize this in ${maxLength} characters or less. Focus on key decisions, conclusions, and important information. Be direct.

Text: "${text.substring(0, 3000)}"

Summary:`

    try {
      return await this.generate(prompt)
    } catch {
      return text.substring(0, maxLength) + '...'
    }
  }

  async extractDecision(text: string): Promise<{ isDecision: boolean; decision?: string; reasoning?: string; alternatives?: string[] }> {
    const prompt = `Analyze if this text contains an architectural or technical decision. If yes, extract the decision, reasoning, and any rejected alternatives.

Text: "${text.substring(0, 2000)}"

Respond with JSON only:
{"isDecision": boolean, "decision": "string or null", "reasoning": "string or null", "alternatives": ["array of strings or empty"]}`

    try {
      const response = await this.generate(prompt)
      const match = response.match(/\{[\s\S]*\}/)
      if (match) {
        return JSON.parse(match[0])
      }
    } catch {
      // ignore
    }
    return { isDecision: false }
  }

  private fallbackEmbed(text: string): number[] {
    // Deterministic hash-based fallback embedding (64 dims)
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

  private simpleEntityExtract(text: string): Array<{ name: string; type: string }> {
    const techWords = ['react', 'node', 'typescript', 'python', 'postgres', 'redis', 'docker', 'kubernetes',
      'aws', 'gcp', 'azure', 'firebase', 'supabase', 'graphql', 'rest', 'sql', 'nosql',
      'mongodb', 'elasticsearch', 'kafka', 'rabbitmq', 'nginx', 'express', 'fastapi']
    const entities: Array<{ name: string; type: string }> = []
    const lower = text.toLowerCase()
    for (const tech of techWords) {
      if (lower.includes(tech)) {
        entities.push({ name: tech.charAt(0).toUpperCase() + tech.slice(1), type: 'technology' })
      }
    }
    return entities.slice(0, 8)
  }
}
