---
"@mcut/transcription": minor
"@mcut/mcp-server": minor
---

New `correct_transcript { find, replace }` MCP tool fixes a misheard name or term in every caption and in the stored transcript as one undo step. It matches whole words, ignores case, and keeps word timings. A multi-word `find` merged into one word spans the words it replaces, a multi-word `replace` splits their timing by character share, and a match split across two captions moves into the first one. `apply_captions` without a transcript now picks up caption text edited with its word timings in sync, instead of refusing it as a mismatch.

`@mcut/transcription` adds `correctCaptions`, `correctWords`, and `retypeCaption`, which rewrites a caption's text while keeping the timing of every word left unchanged.
