---
'@mcut/transcription': minor
'@mcut/mcp-server': minor
---

Add `findRetakes` over word-timed transcripts and the `find_retakes` MCP tool, which returns candidate ranges that keep the last take, last to first. With `elementId` it also returns that clip's transcript in source time, ready to re-caption the clip after the cuts.
