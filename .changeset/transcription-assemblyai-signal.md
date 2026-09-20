---
"@mcut/transcription-assemblyai": patch
---

`transcribe` honors `TranscribeOptions.signal`, so an aborted signal stops the poll loop and rejects with an error naming cancellation instead of polling forever.
