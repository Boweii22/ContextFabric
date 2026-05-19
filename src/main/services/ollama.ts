import axios, { AxiosInstance } from 'axios'

interface OllamaChatResponse {
  message: { role: string; content: string }
  done: boolean
}

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

  // Strip Gemma 4 thinking tokens and clean up the response
  private clean(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\|.*?\|>/g, '')
      .trim()
  }

  // Use /api/generate (more reliable than /api/chat for Gemma 4 via Ollama)
  private async generate(prompt: string): Promise<string> {
    const res = await this.client.post<OllamaGenerateResponse>('/api/generate', {
      model: this.model,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_ctx: 4096,
        num_predict: 400,
        stop: ['\n\n\n', '---'],
      },
    })
    return this.clean(res.data.response || '')
  }

  async embed(text: string): Promise<number[]> {
    try {
      const res = await this.client.post<OllamaEmbedResponse>('/api/embeddings', {
        model: this.embeddingModel,
        prompt: text.substring(0, 512),
      })
      return res.data.embedding || []
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
    contextChunks: Array<{ content: string; source: string; timestamp: number }>,
    importLines: string[] = []
  ): Promise<{ answer: string; reasoning: string }> {

    // Build a tight, no-fluff prompt — no system block, just direct instruction
    const parts: string[] = []

    // Put imports first if we have them — most useful for stack questions
    if (importLines.length > 0) {
      parts.push(`Libraries/imports found in the project:\n${importLines.slice(0, 30).join('\n')}`)
    }

    // Then the actual source chunks (trimmed)
    const chunks = contextChunks
      .filter(c => !c.source.includes('Auto-extracted')) // already handled above
      .slice(0, 4)

    if (chunks.length > 0) {
      parts.push(
        chunks
          .map((c, i) => `[${i + 1}] ${c.source}\n${c.content.substring(0, 300)}`)
          .join('\n\n')
      )
    }

    const context = parts.join('\n\n---\n\n')

    const prompt = context
      ? `Context from my personal projects:\n${context}\n\nAnswer this question directly and concisely: ${userQuery}`
      : `Answer this question directly: ${userQuery}\n(No personal context found.)`

    let answer: string
    try {
      answer = await this.generate(prompt)
    } catch (err) {
      throw new Error(`Ollama failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }

    // If Gemma still returns empty, build answer from imports directly
    if (!answer || answer.length < 5) {
      if (importLines.length > 0) {
        answer = this.buildStackAnswerFromImports(importLines, userQuery)
      } else {
        answer = 'No matching content found in your indexed sources for this query.'
      }
    }

    const reasoning = chunks.length > 0
      ? `Found ${chunks.length} relevant chunk(s). ${importLines.length > 0 ? `Detected ${importLines.length} import statements.` : ''}`
      : 'No source chunks matched — answer based on imports only.'

    return { answer, reasoning }
  }

  // Deterministic stack answer from import lines — works even when Gemma returns empty
  private buildStackAnswerFromImports(imports: string[], query: string): string {
    const all = imports.join(' ').toLowerCase()

    const detected: string[] = []

    // Languages
    if (imports.some(l => l.match(/^(import |from )/))) detected.push('Python')
    if (imports.some(l => l.match(/^(import |from |require\(|const |let )/) && l.match(/\.ts|\.tsx|typescript/))) detected.push('TypeScript')
    if (imports.some(l => l.match(/^(import |from |require\()/) && !l.match(/^(import |from ).*\.py/))) {
      if (all.includes('.js') || all.includes('node') || all.includes('express') || all.includes('react')) detected.push('JavaScript/Node.js')
    }

    // Python frameworks
    if (all.includes('flask')) detected.push('Flask')
    if (all.includes('fastapi')) detected.push('FastAPI')
    if (all.includes('django')) detected.push('Django')
    if (all.includes('streamlit')) detected.push('Streamlit')
    if (all.includes('gradio')) detected.push('Gradio')

    // JS frameworks
    if (all.includes('react')) detected.push('React')
    if (all.includes('next')) detected.push('Next.js')
    if (all.includes('vue')) detected.push('Vue')
    if (all.includes('express')) detected.push('Express')

    // AI/ML
    if (all.includes('openai')) detected.push('OpenAI API')
    if (all.includes('anthropic')) detected.push('Anthropic/Claude API')
    if (all.includes('langchain')) detected.push('LangChain')
    if (all.includes('torch') || all.includes('pytorch')) detected.push('PyTorch')
    if (all.includes('tensorflow')) detected.push('TensorFlow')
    if (all.includes('transformers')) detected.push('HuggingFace Transformers')

    // Databases
    if (all.includes('sqlite') || all.includes('sqlite3')) detected.push('SQLite')
    if (all.includes('postgres') || all.includes('psycopg')) detected.push('PostgreSQL')
    if (all.includes('mongodb') || all.includes('pymongo')) detected.push('MongoDB')
    if (all.includes('redis')) detected.push('Redis')
    if (all.includes('supabase')) detected.push('Supabase')

    // HTTP / networking
    if (all.includes('requests')) detected.push('requests (HTTP)')
    if (all.includes('aiohttp')) detected.push('aiohttp')
    if (all.includes('httpx')) detected.push('httpx')
    if (all.includes('selenium') || all.includes('playwright')) detected.push('Browser automation')
    if (all.includes('beautifulsoup') || all.includes('bs4')) detected.push('BeautifulSoup')

    // Remove duplicates
    const unique = [...new Set(detected)]

    if (unique.length === 0) {
      return `Found ${imports.length} import statements in the project but couldn't identify specific frameworks. Here are the imports found:\n${imports.slice(0, 10).join('\n')}`
    }

    const mainLangs = unique.filter(t => ['Python', 'TypeScript', 'JavaScript/Node.js'].includes(t))
    const frameworks = unique.filter(t => !['Python', 'TypeScript', 'JavaScript/Node.js'].includes(t))

    let answer = ''
    if (mainLangs.length > 0) answer += `Language: **${mainLangs.join(', ')}**\n`
    if (frameworks.length > 0) answer += `Libraries/Frameworks: **${frameworks.join(', ')}**\n`
    answer += `\nDetected from ${imports.length} import statements across your indexed source files.`

    return answer
  }

  async extractEntities(text: string): Promise<Array<{ name: string; type: string }>> {
    // Use simple extraction — avoids extra Ollama calls during indexing
    return this.simpleEntityExtract(text)
  }

  async summarize(text: string, maxLength = 150): Promise<string> {
    try {
      const prompt = `Summarize in one sentence (max ${maxLength} chars): ${text.substring(0, 800)}`
      const result = await this.generate(prompt)
      return result.substring(0, maxLength) || text.substring(0, maxLength)
    } catch {
      return text.substring(0, maxLength)
    }
  }

  async extractDecision(text: string): Promise<{
    isDecision: boolean; decision?: string; reasoning?: string; alternatives?: string[]
  }> {
    // Skip for now to keep indexing fast — return false
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
    const techWords = [
      'react', 'node', 'typescript', 'python', 'postgres', 'redis', 'docker',
      'kubernetes', 'aws', 'gcp', 'firebase', 'supabase', 'graphql', 'mongodb',
      'elasticsearch', 'kafka', 'nginx', 'express', 'fastapi', 'prisma', 'sqlite',
      'flask', 'django', 'streamlit', 'openai', 'anthropic', 'langchain'
    ]
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
