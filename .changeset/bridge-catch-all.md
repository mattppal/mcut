---
"@mcut/mcp-server": patch
---

The live bridge answers an unexpected HTTP handler error with 500 and refuses a WebSocket upgrade whose check throws, instead of crashing. `LiveBridgeOptions.onError` receives the error and defaults to stderr.
