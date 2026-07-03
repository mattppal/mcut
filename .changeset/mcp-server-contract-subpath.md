---
"@mcut/mcp-server": patch
---

Add a browser-safe `@mcut/mcp-server/contract` subpath exporting the MCP tool catalog (static tool definitions, profiles, `operatorToolName`, and tool-list composition helpers). The server now registers its tools from this contract, and the wire surface is pinned to it by a deep-equality test.
