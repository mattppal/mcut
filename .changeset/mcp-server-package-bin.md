---
"@mcut/mcp-server": minor
---

Add a `mcp-server` bin so `npx -y @mcut/mcp-server` and `bunx @mcut/mcp-server project.mcut.json` start the stdio server. The bridge `/rpc` endpoint now requires the bridge token, and `mcut-bridge` reads it from `--token` or `MCUT_BRIDGE_TOKEN`.
