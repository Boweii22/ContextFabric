# ContextFabric Browser Extension

This is the local-first bridge for AI tools that do not natively support ContextFabric yet. It runs as a Manifest V3 browser extension and talks only to the local daemon at `http://localhost:47821`.

## Supported Sites

- ChatGPT: `chatgpt.com`, `chat.openai.com`
- Claude: `claude.ai`
- Gemini: `gemini.google.com`
- Perplexity: `perplexity.ai`
- Poe: `poe.com`
- Microsoft Copilot: `copilot.microsoft.com`
- Cursor web surfaces: `cursor.com`, `app.cursor.com`
- Mistral Chat: `chat.mistral.ai`
- DeepSeek, Grok, You.com, Phind, HuggingChat, Kimi, Qwen, NotebookLM, and Google AI Studio

## How It Works

1. The content script adds a small `CF` button to supported AI chat pages.
2. When clicked, the extension asks the local ContextFabric daemon for a signed context token.
3. If the app has not been approved, the daemon creates a permission request.
4. You approve the request in ContextFabric Permissions.
5. The extension retrieves the approved context bundle and inserts it into the active chat box.

## Install For Testing

1. Start the ContextFabric desktop app.
2. Open Chrome or Edge and go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select this folder: `browser-extension`.
6. Open ChatGPT, Claude, or another supported site.
7. Click the `CF` button in the bottom-right corner.
8. If prompted, approve `browser-extension` in ContextFabric Permissions.
9. Click Inject again.

The extension intentionally requires local permission approval. Unknown app IDs are denied by default until a grant is approved.
