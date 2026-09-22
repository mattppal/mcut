---
"@mcut/transcription-local": patch
---

A failed Whisper model load no longer poisons the worker. The next `transcribe` call downloads again instead of replaying the first failure, and the error names the model and the host it was fetched from instead of a bare `Failed to fetch`.
