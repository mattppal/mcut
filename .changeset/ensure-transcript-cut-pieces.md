---
'@mcut/mcp-server': patch
---

`ensure_transcript` recognizes an existing transcript after retake cuts. Captions over any piece on the track that plays the same audio count as that audio's transcript, so a call on another piece returns them instead of transcribing again. When no captions are left but the server stored a transcript for that audio, it places that transcript over every piece instead of transcribing. `replace: true` still transcribes again.
