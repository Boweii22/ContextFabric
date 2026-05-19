# ContextFabric

**One Memory Across Every AI Tool**

> Your personal AI context layer — a local-first memory operating system that unifies your conversations, notes, code, and decisions into searchable intelligence.

---

## What It Solves

AI memory is fragmented. Claude remembers your Claude conversations. ChatGPT remembers its own. Your codebase, notes, and documents sit siloed. Every AI tool starts from scratch.

ContextFabric gives you **one unified memory graph** that any AI tool can query — running entirely on your machine.

---

## Core Features

| Feature | Description |
|---|---|
| **Memory Graph** | Interactive knowledge graph of all your nodes, decisions, and relationships |
| **AI Reasoning Search** | Ask natural-language questions; Gemma reasons across all sources with citations |
| **Source Traceability** | Every answer shows exact source, file, timestamp, clickable navigation |
| **Live Timeline** | How your decisions and architecture evolved over time |
| **Context Injection API** | Local HTTP API (port 47821) for IDE plugins and other AI tools |
| **Local-First Privacy** | Everything runs on your machine; zero cloud dependency |

---

## Tech Stack

- **Desktop**: Electron 29 + React 18 + TypeScript
- **UI**: TailwindCSS + Framer Motion + Radix UI + Lucide
- **Graph**: @xyflow/react (React Flow v12)
- **State**: Zustand
- **Storage**: SQLite via better-sqlite3 (WAL mode, FTS5 full-text search)
- **AI**: Ollama (local) — Gemma 3 12B recommended
- **Embeddings**: nomic-embed-text via Ollama
- **Backend API**: Express (local HTTP server on port 47821)

---

## Prerequisites

### 1. Node.js
Node.js 20+ required. [Download](https://nodejs.org)

### 2. Ollama (for AI features)
Install from [ollama.ai](https://ollama.ai), then pull the required models:

```bash
# Primary reasoning model (12B recommended, 8B works on 8GB RAM)
ollama pull gemma4:e4b

# Embedding model (required for semantic search)
ollama pull nomic-embed-text
```

> ContextFabric works without Ollama using keyword-only search, but semantic reasoning requires it.

### 3. Windows: Build Tools (for better-sqlite3)
If you see compilation errors on Windows, install build tools:
```bash
npm install --global windows-build-tools
# OR install "Desktop development with C++" in Visual Studio
```

---

## Installation & Development

```bash
# Clone and install
git clone https://github.com/yourname/contextfabric
cd contextfabric
npm install

# Rebuild native modules for Electron
npx electron-rebuild -f -w better-sqlite3

# Start development
npm run dev
```

### Production Build

```bash
npm run build      # Build all targets
npm run package    # Build + package installer
```

---

## First Run

1. **Onboarding** — 5-step wizard configures AI models and explains the concept
2. **Add a Source** — Go to Sources → Add Source → select type (Claude export, local folder, etc.)
3. **Sync** — Click the refresh icon; Gemma processes each chunk:
   - Entity extraction
   - Decision detection → Timeline events
   - Embeddings generation
   - Graph edge computation
4. **Query** — Go to AI Query and ask anything: *"Why did I reject Supabase?"*

---

## Supported Data Sources

| Source | Format | Notes |
|---|---|---|
| Claude Export | `.json` | Settings → Export Data in Claude.ai |
| ChatGPT Export | `conversations.json` | Settings → Data Controls → Export (**warning: takes days to arrive**) |
| Local Folder | Directory | Indexes `.md .txt .ts .tsx .js .py .go .rs .json .yaml` |
| GitHub Repo | Local clone | Treats as local folder |
| Markdown File | `.md` | Single file or Obsidian vault root |
| PDF | `.pdf` | Text extraction via pdf-parse |
| Notion Export | Directory | Export as Markdown & CSV |
| VSCode Workspace | Directory | Indexes project root |

---

## Architecture

```
ContextFabric/
├── src/
│   ├── main/                  # Electron main process (Node.js)
│   │   ├── index.ts           # App entry, BrowserWindow
│   │   ├── ipc/               # IPC handlers (bridges renderer↔main)
│   │   ├── services/
│   │   │   ├── database.ts    # SQLite (nodes, edges, embeddings, FTS)
│   │   │   ├── ollama.ts      # Ollama REST client (generate, embed, extract)
│   │   │   ├── ingestion.ts   # File parsing, chunking, enrichment pipeline
│   │   │   └── search.ts      # Hybrid semantic + keyword search
│   │   └── api/
│   │       └── server.ts      # Express HTTP API on :47821
│   ├── preload/
│   │   └── index.ts           # contextBridge — exposes window.api to renderer
│   ├── renderer/              # React frontend
│   │   └── src/
│   │       ├── App.tsx        # Router + global data loading
│   │       ├── store/         # Zustand global state
│   │       ├── pages/         # 8 full-screen pages
│   │       ├── components/    # Shared layout components
│   │       └── lib/           # Utilities + API wrapper
│   └── shared/
│       └── types.ts           # Shared TypeScript types (main + renderer)
```

### Data Flow

```
File / Export
     │
     ▼
IngestionService.ingestSource()
  ├── Parse (Claude JSON / folder walk / PDF)
  ├── Chunk (2000 char paragraphs with overlap)
  ├── Ollama: extractEntities() → Entity table
  ├── Ollama: extractDecision() → Timeline events
  ├── Ollama: summarize() → node.summary
  ├── Ollama: embed() → Float32 vector in SQLite BLOB
  └── buildGraphEdges() → cosine similarity > 0.75

                    │
                    ▼
            SQLite (WAL mode)
     ┌─────────────────────────────┐
     │ memory_nodes (FTS5 indexed) │
     │ memory_embeddings (BLOB)    │
     │ memory_edges                │
     │ entities                    │
     │ timeline_events             │
     └─────────────────────────────┘
                    │
                    ▼
         SearchService.hybridSearch()
           ├── Semantic: cosine similarity over all embeddings
           └── Keyword: FTS5 BM25 ranking
                    │
                    ▼
         OllamaService.queryWithContext()
           └── Gemma 3 reasons over top-12 chunks → Answer + Citations
```

---

## Local Context API

Other tools query your memory via the local HTTP API:

```bash
# Check status
curl http://localhost:47821/health

# Query your context
curl -X POST http://localhost:47821/api/context \
  -H "Content-Type: application/json" \
  -d '{"query": "auth system architecture", "limit": 5}'

# Response
{
  "query": "auth system architecture",
  "results": [
    {
      "content": "...",
      "source": "My Claude Conversations",
      "title": "Auth Discussion — Session Tokens",
      "timestamp": 1703123456000,
      "score": 0.87
    }
  ]
}
```

### VSCode Extension Integration

Add to your `.vscode/settings.json` or AI assistant config:
```json
{
  "contextfabric.apiUrl": "http://localhost:47821",
  "contextfabric.enabled": true
}
```

---

## Demo Scenarios

### "Why did I stop using Firebase?"

ContextFabric reconstructs:
- Conversations where Firebase was discussed
- The alternative (e.g., Supabase/PlanetScale) that won
- Code commits or notes referencing the decision
- Timeline of when the switch happened
- Exact quotes with source citations

### "Summarize everything about my auth architecture"

Returns:
- All conversations touching auth
- Architecture decisions extracted to Timeline
- Entity graph showing auth-related concepts
- Evolution from first mention to current state

---

## Privacy

- **Zero cloud**: All data stays on your machine
- **Local inference**: Gemma runs via Ollama on your hardware
- **SQLite storage**: `~/.config/ContextFabric/data/contextfabric.db`
- **No telemetry** by default (opt-in only)
- **Source permissions**: Per-source access controls for the local API

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Ollama not connecting | Make sure Ollama is running: `ollama serve` |
| No models available | Pull models: `ollama pull gemma4:e4b nomic-embed-text` |
| Slow indexing | Use smaller model: `ollama pull gemma4:e4b` |
| SQLite compile error | Run `npx electron-rebuild -f -w better-sqlite3` |
| FTS search errors | Avoid special characters in queries |
| Graph not rendering | Refresh after indexing completes |

---

## Roadmap

- [ ] Obsidian plugin
- [ ] VSCode extension (native)
- [ ] Claude MCP server integration
- [ ] Automatic background sync (file watcher)
- [ ] Memory compression / summarization clusters
- [ ] Conflict detection (contradictory decisions)
- [ ] Export to markdown / PDF
- [ ] Multi-user / team context (local network)

---

## License

MIT © ContextFabric
