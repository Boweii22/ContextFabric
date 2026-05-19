import axios, { AxiosInstance } from 'axios'

interface OllamaChatResponse {
  message: { role: string; content: string }
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

const CHAT_OPTIONS = {
  temperature: 0.1,
  num_ctx: 2048,         // small — fast
  num_predict: 512,      // cap output tokens
}

const EMBED_OPTIONS = {
  temperature: 0,
  num_ctx: 512,
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

  // Use /api/chat — works more reliably with Gemma 4 than /api/generate
  private async chat(userMessage: string, systemMessage?: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = []
    if (systemMessage) messages.push({ role: 'system', content: systemMessage })
    messages.push({ role: 'user', content: userMessage })

    const res = await this.client.post<OllamaChatResponse>('/api/chat', {
      model: this.model,
      messages,
      stream: false,
      options: CHAT_OPTIONS,
    })
    return res.data.message?.content?.trim() || ''
  }

  async embed(text: string): Promise<number[]> {
    try {
      const res = await this.client.post<OllamaEmbedResponse>('/api/embeddings', {
        model: this.embeddingModel,
        prompt: text.substring(0, 500),
        options: EMBED_OPTIONS,
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

  async queryWithContext(
    userQuery: string,
    contextChunks: Array<{ content: string; source: string; timestamp: number }>
  ): Promise<{ answer: string; reasoning: string }> {
    // Keep context tight — 4 sources, 400 chars each
    const contextText = contextChunks
      .slice(0, 4)
      .map((c, i) =>
        `[${i + 1}] ${c.source} (${new Date(c.timestamp).toLocaleDateString()}):\n${c.content.substring(0, 400)}`
      )
      .join('\n\n')

    const system = `You answer questions about the user's personal notes, conversations, and projects.
Use only the provided sources. Cite with [1], [2] etc. Be concise.`

    const prompt = contextText
      ? `Sources:\n${contextText}\n\nQuestion: ${userQuery}`
      : `Question: ${userQuery}\n\n(No relevant sources found — answer from general knowledge if possible.)`

    let answer: string
    try {
      answer = await this.chat(prompt, system)
    } catch (err) {
      throw new Error(`Ollama generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }

    // Skip second reasoning call — derive it from the answer itself
    const reasoning = contextChunks.length > 0
      ? `Based on ${contextChunks.length} source chunk(s) from your knowledge base.`
      : 'No matching sources found in your indexed memory.'

    return { answer, reasoning }
  }

  async extractEntities(text: string): Promise<Array<{ name: string; type: string }>> {
    const prompt = `List up to 8 named entities in this text as JSON array: [{"name":"...","type":"..."}]
Types: technology, person, project, concept, tool, organization
Text: ${text.substring(0, 800)}
JSON:`

    try {
      const response = await this.chat(prompt)
      const match = response.match(/\[[\s\S]*?\]/)
      if (match) {
        const parsed = JSON.parse(match[0])
        return Array.isArray(parsed) ? parsed.slice(0, 8) : []
      }
    } catch {
      // ignore — fall back to simple extraction
    }
    return this.simpleEntityExtract(text)
  }

  async summarize(text: string, maxLength = 150): Promise<string> {
    const prompt = `Summarize in one sentence (max ${maxLength} chars): ${text.substring(0, 1000)}`
    try {
      const result = await this.chat(prompt)
      return result.substring(0, maxLength)
    } catch {
      return text.substring(0, maxLength)
    }
  }

  async extractDecision(text: string): Promise<{ isDecision: boolean; decision?: string; reasoning?: string; alternatives?: string[] }> {
    const prompt = `Does this text contain an architectural or technical decision? Reply with JSON only.
{"isDecision":bool,"decision":"string or null","reasoning":"string or null","alternatives":[]}
Text: ${text.substring(0, 600)}`

    try {
      const response = await this.chat(prompt)
      const match = response.match(/\{[\s\S]*?\}/)
      if (match) return JSON.parse(match[0])
    } catch {
      // ignore
    }
    return { isDecision: false }
  }

  private fallbackEmbed(text: string): number[] {
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
    const techWords = ['react', 'node', 'typescript', 'python', 'postgres', 'redis', 'docker',
      'kubernetes', 'aws', 'gcp', 'firebase', 'supabase', 'graphql', 'mongodb',
      'elasticsearch', 'kafka', 'nginx', 'express', 'fastapi', 'prisma', 'sqlite']
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
