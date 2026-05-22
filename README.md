# ContextFabric Gemma 4

**A local-first AI memory layer powered by Gemma 4.**

ContextFabric gives your AI tools a shared, private memory graph. It imports real folders, repos, ChatGPT exports, Claude exports, notes, and documents, then uses local Gemma 4 through Ollama to extract useful context, reason over it, and answer with source citations.

This project is built for the **DEV Gemma 4 Challenge: Build With Gemma 4**.

## Why Gemma 4

ContextFabric needs a model that can run locally, read messy project context, and turn it into useful structured memory without sending private data to a cloud service.

The default setup uses:

- **Gemma 4 E2B via Ollama** as the preferred local edge reasoning model.
- **Gemma 4 E4B** as a larger fallback if E2B is not available from your Ollama install yet.
- **`cf-gemma4`** as a low-memory local profile created from the installed Gemma 4 source model.
- **`nomic-embed-text`** for semantic embeddings.

Gemma 4 is used for real work:

- answering natural-language questions over indexed memory
- summarizing source chunks
- extracting entities, tools, and project concepts
- detecting technical decisions
- creating context bundles that can be permission-served to other AI tools

See [GEMMA4.md](GEMMA4.md) for the model choice, E2B rationale, offline proof, and exact Gemma responsibilities.

## Current Product Surface

- Desktop app built with Electron, React, TypeScript, and SQLite
- Local data import screen for folders, repos, ChatGPT exports, Claude exports, markdown, PDFs, and Notion exports
- AI Query page with streaming answers, citations, reasoning details, and history
- Memory graph and timeline views
- Permission request flow for external apps
- Local HTTP context API on `127.0.0.1:47821`
- Browser extension bridge for ChatGPT, Claude, Gemini, Perplexity, Cursor, and other AI sites
- Encrypted-at-rest graph storage and secure local key handling
- CR-SQLite-style local sync foundation
- Gemma Evidence page that runs live checks against real indexed sources

## Requirements

- Windows, macOS, or Linux
- Node.js 20 or 22. Node 24 is not recommended for this Electron/native SQLite stack.
- npm
- Ollama from [ollama.com](https://ollama.com)
- Enough free RAM to load your selected Gemma 4 model

## 5-Minute Judge Setup

For the shortest path, install [Ollama](https://ollama.com), then run:

```bash
git clone https://github.com/Boweii22/ContextFabric.git
cd ContextFabric
npm run start
```

`npm run start` is the recommended command for normal users, judges, and fresh clones. It checks/repairs npm dependencies, starts Ollama if it is not already running, pulls Gemma 4 plus the local embedding model, verifies the local Gemma runtime, and starts ContextFabric.

On macOS, use Node 20 or 22. If you have `nvm`, run:

```bash
nvm install 20
nvm use 20
npm run start
```

If a Mac clone reports `electron-vite: command not found`, the npm install is incomplete or dev dependencies were omitted. Repair it with:

```bash
nvm use 20
rm -rf node_modules
npm install --include=dev
npm run start
```

Do not run `electron-rebuild` manually for normal setup.

Use `npm run dev` only if dependencies are already installed and you are actively developing the Electron app. For everyone else, use `npm run start`.

Open the local demo UI:

```text
http://127.0.0.1:7749/ui
```

The fastest proof path is:

1. Paste a paragraph into **Extract Context**.
2. Click **Extract and save**.
3. Confirm typed nodes appear with confidence scores.
4. Check the **Claude Context Preview** panel.

## Install

```bash
git clone https://github.com/Boweii22/ContextFabric.git
cd ContextFabric
npm install
```

After install, start the product with:

```bash
npm run start
```

For development-only hot reload:

```bash
npm run dev
```

## Install Gemma 4 Locally

Install Ollama, then pull the models:

```bash
ollama pull gemma4:e2b
ollama pull nomic-embed-text
```

If Ollama cannot pull `gemma4:e2b` on your machine yet, use the larger fallback:

```bash
ollama pull gemma4:e4b
```

ContextFabric uses a low-memory profile called `cf-gemma4`. Create and verify it with:

```bash
npm run verify:gemma
```

Expected success:

```text
PASS Ollama is running
PASS Gemma source model is installed
PASS Constrained model profile exists
PASS Gemma responded: ...
Gemma verification passed.
```

If verification fails with a memory allocation error, close browsers/editors and rerun:

```bash
npm run verify:gemma
```

For very tight machines, lower the context window:

```bash
set CONTEXTFABRIC_GEMMA_NUM_CTX=128
npm run verify:gemma
```

## Prove It Works Offline

This is the privacy proof for the challenge submission:

1. Start Ollama.
2. Run `npm run verify:gemma` while online.
3. Disconnect WiFi.
4. Run the same command again:

```bash
npm run verify:gemma
```

If it passes offline, Gemma 4 is running locally with zero network egress for generation.

## Run The App

```bash
npm run start
```

For development hot reload after dependencies are already installed:

```bash
npm run dev
```

First real test:

1. Open **Sources**.
2. Add a real project folder or GitHub repo.
3. Click **Sync**.
4. Open **Gemma Evidence**.
5. Run **Project understanding**.
6. Confirm the answer cites your real indexed sources.

## Build And Verify

```bash
npm run build
npm run e2e
npm run verify:gemma
node scripts/package-extension.mjs --validate
```

## Environment

Optional runtime overrides are documented in `.env.example`.

```bash
CONTEXTFABRIC_OLLAMA_URL=http://127.0.0.1:11434
CONTEXTFABRIC_OLLAMA_MODEL=cf-gemma4
CONTEXTFABRIC_GEMMA_SOURCE_MODEL=gemma4:e2b
CONTEXTFABRIC_GEMMA_NUM_CTX=128
CONTEXTFABRIC_GEMMA_NUM_PREDICT=32
CONTEXTFABRIC_GEMMA_NUM_BATCH=4
```

## Local API

ContextFabric starts a local-only API on `127.0.0.1:47821`.

Request app permission:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:47821/api/permission/request" `
  -Headers @{ "X-ContextFabric-App" = "judge-demo" } `
  -ContentType "application/json" `
  -Body '{"scopes":["context"],"reason":"Judge wants to inspect local Gemma memory context"}'
```

After approving in the app, request a token:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:47821/api/token" `
  -Headers @{ "X-ContextFabric-App" = "judge-demo" } `
  -ContentType "application/json" `
  -Body '{"query":"current project context and technical decisions","ttlSeconds":3600}'
```

## Challenge API

For demos, curl, and judges, ContextFabric also starts a simple local-only API on `127.0.0.1:7749`. It is bound to loopback only, so it is not reachable from the internet or your LAN.

Open the screenshot-ready local web UI:

```text
http://127.0.0.1:7749/ui
```

Health and model availability:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:7749/health"
```

Extract typed memory nodes from text with Gemma 4:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:7749/extract" `
  -ContentType "application/json" `
  -Body '{"title":"Demo context","text":"ContextFabric is a local-first AI memory layer. I prefer concise answers and real working features.","save":true}'
```

Get an app-aware context payload:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:7749/context?app=claude&query=current%20project%20context&maxWords=800"
```

Create and delete a manual node:

```powershell
$node = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:7749/nodes" `
  -ContentType "application/json" `
  -Body '{"type":"preference","title":"Answer style","content":"The user prefers simple testing steps and no fake demos.","confidence":0.95}'

Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:7749/nodes/$($node.node.id)"
```

Requests are logged locally to the app data folder as `logs/local-api-7749.log`.

## Browser Extension

Package the extension:

```bash
npm run extension:package
```

Load unpacked from:

```text
browser-extension/
```

or package output:

```text
dist/browser-extension/contextfabric-bridge-0.1.0
```

## Challenge Narrative

ContextFabric is not another chatbot. It is local AI memory infrastructure:

1. Gemma 4 reads your real project material locally.
2. ContextFabric stores the extracted memory as a structured graph.
3. You grant apps scoped access through local permission tokens.
4. Any AI tool can start with relevant context without that context living in a vendor silo.

The challenge value is the combination of:

- local Gemma 4 reasoning
- private personal context graph
- source-cited answers
- permissioned context portability
- browser extension bridge for existing AI tools

## Troubleshooting

| Problem | Fix |
|---|---|
| Ollama not reachable | Start Ollama, then run `npm run verify:gemma` |
| `gemma4:e2b` missing | Run `ollama pull gemma4:e2b`. If Ollama rejects that tag, run `ollama pull gemma4:e4b` as the larger fallback. |
| `memory layout cannot be allocated` | Close heavy apps, run `npm run verify:gemma`, or set `CONTEXTFABRIC_GEMMA_NUM_CTX=128` |
| Embeddings missing | Run `ollama pull nomic-embed-text` |
| No good answers | Sync a real source first, then use Gemma Evidence |
| Browser extension cannot inject | Approve the permission request in ContextFabric Permissions |

## License

MIT
