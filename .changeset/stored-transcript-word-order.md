---
'@mcut/mcp-server': patch
---

The stored transcript keeps the word order it was given instead of sorting by start time. Whisper can start a word a little before the one ahead of it, and the sorted copy stopped matching the captions made from it, so `apply_captions { elementId }` after a cut refused it.
