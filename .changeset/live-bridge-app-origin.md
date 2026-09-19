---
"@mcut/mcp-server": patch
---

The live bridge checks an exact `allowedOrigins` match before the `http:` and `https:` protocol test, so a desktop shell serving Studio from a custom scheme such as `app://studio` can connect. `GET /status` no longer returns `mcpUrl` or `openEditorUrl`, which carried the bridge token to any local process. Read the MCP URL from the `MCP_URL` line the bridge prints when it starts. `mcut bridge start` still prints the editor URL at startup.
