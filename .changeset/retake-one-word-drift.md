---
"@mcut/transcription": patch
---

`findRetakes` tolerates one dropped or inserted word inside a matched opening, so "hopefully take this as an example" still matches its retake "hopefully you take this as an example". Only matched words count toward `minMatchWords`.
