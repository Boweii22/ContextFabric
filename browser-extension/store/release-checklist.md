# Extension Release Checklist

1. Run `npm run extension:validate`.
2. Run `npm run extension:package`.
3. Load `dist/browser-extension/contextfabric-bridge-<version>` unpacked in Chrome or Edge.
4. Test ChatGPT and Claude injection.
5. Test denied permission, one-hour grant, session grant, and always grant.
6. Upload `dist/browser-extension/contextfabric-bridge-<version>.zip` to the Chrome Web Store dashboard.
7. Paste the single-purpose, permissions, and privacy text from this folder into the store listing.
