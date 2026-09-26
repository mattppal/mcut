---
"@mcut/mcp-server": patch
---

`find_retakes` accepts a multicam through its audio source, including each piece left after a cut, and maps each word into that asset's media time. `apply_captions` treats a transcript as the project's when the caption words are that transcript with gaps, and still warns for a different transcript.
