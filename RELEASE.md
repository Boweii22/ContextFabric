# ContextFabric Release Flow

Use this for a local one-command release build:

```powershell
npm run release:local
```

The release flow performs:

1. Desktop app production build.
2. Browser extension manifest validation.
3. Browser extension zip packaging.
4. E2E smoke checks.
5. Windows desktop release folder through `electron-builder`.
6. Zip packaging for the Windows desktop app.

Outputs:

- Desktop release zip: `dist/ContextFabric-1.0.0-win-unpacked.zip`
- Runnable desktop app folder: `dist/win-unpacked/`
- Browser extension zip: `dist/browser-extension/contextfabric-bridge-0.1.0.zip`
- Release notes: `dist/release-notes/`

For a traditional NSIS installer, run:

```powershell
npm run package
```

Before sharing a release, smoke test:

1. Extract the generated Windows zip.
2. Start `ContextFabric.exe`.
3. Add one source and sync it.
4. Ask a query.
5. Load the extension unpacked and inject context into ChatGPT or Claude.
6. Check Permissions and Access Log.
