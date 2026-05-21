# ContextFabric Bridge Privacy Policy

ContextFabric Bridge is local-first.

The extension communicates with the ContextFabric desktop app on `localhost`. It does not send data to ContextFabric servers, third-party analytics, advertising networks, or external APIs.

The extension stores only local configuration:

- local daemon URL
- app id
- default context query
- prompt-size preference

When the user clicks Inject or Copy, the extension asks the local daemon for an approved context bundle. If permission has not been granted, the daemon creates a local permission request. The user must approve that request inside the ContextFabric desktop app.

The extension can read and write text inside supported AI chat pages only to insert the approved context prompt requested by the user.
