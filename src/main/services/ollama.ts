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

  private async generate(prompt: string): Promise<string> {
    try {
      // Send NO options — let Ollama use the model's own defaults.
      // Passing num_ctx/num_predict for certain Gemma 4 variants causes HTTP 500.
      const res = await this.client.post<OllamaGenerateResponse>('/api/generate', {
        model: this.model,
        prompt,
        stream: false,
      })
      return this.clean(res.data.response || '')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string }
      const status = axiosErr?.response?.status
      const body = axiosErr?.response?.data

      // Extract Ollama's own error message from the response body
      let ollamaMsg = ''
      if (body && typeof body === 'object') {
        ollamaMsg = (body as { error?: string }).error || JSON.stringify(body)
      }

      // On 500: retry once with a much shorter prompt, still no options
      if (status === 500) {
        console.warn('[Ollama] 500 on full prompt, retrying with short prompt. Ollama said:', ollamaMsg)
        const shortPrompt = prompt.length > 600
          ? prompt.substring(0, 600) + '\n\nAnswer briefly:'
          : prompt
        try {
          const retry = await this.client.post<OllamaGenerateResponse>('/api/generate', {
            model: this.model,
            prompt: shortPrompt,
            stream: false,
          })
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
    contextChunks: Array<{ content: string; source: string; timestamp: number }>,
    importLines: string[] = [],
    sourceMeta = ''
  ): Promise<{ answer: string; reasoning: string }> {

    const chunks = contextChunks.slice(0, 5)

    let prompt = `You are a personal AI assistant. Answer the question using the context below. Be specific and direct.\n\n`

    // Always include source list — tells Gemma the project name from the path
    if (sourceMeta) {
      prompt += `Connected knowledge sources:\n${sourceMeta}\n\n`
    }

    if (importLines.length > 0) {
      prompt += `Imports/libraries detected in project files:\n${importLines.slice(0, 20).join('\n')}\n\n`
    }

    if (chunks.length > 0) {
      prompt += `Relevant file contents:\n`
      chunks.forEach((c, i) => {
        prompt += `\n[${i + 1}] ${c.source}\n${c.content.substring(0, 350)}\n`
      })
      prompt += `\n`
    }

    prompt += `Question: ${userQuery}\n\nAnswer:`

    let answer = ''
    try {
      answer = await this.generate(prompt)
    } catch (err) {
      throw new Error(`Ollama failed: ${err instanceof Error ? err.message : 'Unknown'}`)
    }

    // Empty response fallback — only use stack detection for stack questions
    if (!answer || answer.length < 8) {
      const isStackQuestion = /stack|technolog|framework|language|library|built with|dependencies/i.test(userQuery)
      if (isStackQuestion && importLines.length > 0) {
        answer = this.buildStackAnswer(importLines)
      } else if (chunks.length > 0) {
        // Give the user the raw context so they can see what was found
        answer = `I found ${chunks.length} relevant source(s) but couldn't generate a response. Here's what was found:\n\n` +
          chunks.slice(0, 2).map(c => `From "${c.source}":\n${c.content.substring(0, 200)}`).join('\n\n')
      } else {
        answer = `Nothing found in your indexed sources matching "${userQuery}". Try syncing your sources first, or rephrase the question.`
      }
    }

    const reasoning = chunks.length > 0
      ? `Searched ${chunks.length} source chunk(s).${importLines.length > 0 ? ` Found ${importLines.length} import statements.` : ''}`
      : 'No matching sources found in your knowledge base.'

    return { answer, reasoning }
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
    return this.simpleEntityExtract(text)
  }

  async summarize(text: string, maxLength = 150): Promise<string> {
    return text.substring(0, maxLength)
  }

  async extractDecision(text: string): Promise<{
    isDecision: boolean; decision?: string; reasoning?: string; alternatives?: string[]
  }> {
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
