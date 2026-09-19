---
"@mcut/mcp-server": patch
"@mcut/transcription": patch
---

Static MCP tool arguments are parsed with zod before the handler runs and a bad argument is reported by field name, and `@mcut/transcription` exports `transcriptResultSchema` as the source of its `TranscriptResult` type.
