---
"@mcut/timeline": patch
"@mcut/mcp-server": patch
---

`removeRanges` keeps the keyframes of a text or image element that spans a removed range. Keyframes after the range shift left with the content and keyframes inside it are dropped, so a title's fade-out survives a retake cut. The MCP server's import media schemas and transcript search move to their own modules, with the same exports from `@mcut/mcp-server/contract`.
