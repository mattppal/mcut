---
'@mcut/transcription-local': patch
---

Time out a stalled Whisper model load and restart the worker after any load failure, so every waiting transcription settles with the model-load error instead of hanging.
