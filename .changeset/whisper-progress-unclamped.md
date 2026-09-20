---
"@mcut/transcription-local": patch
---

Aggregated Whisper download progress no longer locks at 100% after the first small model file completes, and a rejected `navigator.gpu.requestAdapter()` falls back to `wasm` instead of failing the transcription.
