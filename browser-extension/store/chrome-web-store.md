# Chrome Web Store Submission

## Single Purpose

ContextFabric Bridge lets users inject approved local ContextFabric memory into AI chat tools such as ChatGPT, Claude, Gemini, Perplexity, Copilot, Cursor web surfaces, Mistral, DeepSeek, Grok, and related assistants.

## Description

ContextFabric Bridge connects supported AI chat websites to the local ContextFabric desktop daemon running on the user's own machine. The extension does not send memory to a cloud service. It requests a signed local context bundle from `http://localhost:47821`, then inserts that user-approved context into the active chat box.

Unknown apps must be approved in ContextFabric Permissions before context can be retrieved.

## Permissions Justification

- `storage`: saves the local daemon URL, extension app id, default context query, and prompt-size preference.
- `activeTab`: lets the extension interact with the current supported AI chat page after user action.
- Host permissions for supported AI domains: required to inject the small ContextFabric button and insert context into chat inputs.
- `localhost` / `127.0.0.1`: required to communicate with the local ContextFabric daemon.

## Data Usage

The extension does not collect analytics, does not use remote servers, and does not sell or transfer user data. Context is retrieved only from the local daemon after the user grants permission in the desktop app.

## Review Notes

1. Start the ContextFabric desktop app.
2. Load the extension.
3. Open a supported AI chat website.
4. Click the `CF` button.
5. Approve `browser-extension` in ContextFabric Permissions.
6. Click Inject.

Expected result: the approved local context prompt is inserted into the chat input.
