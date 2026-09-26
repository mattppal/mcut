---
"@mcut/transcription-local": minor
"@mcut/transcription": patch
"@mcut/mcp-server": patch
---

The on-device Whisper provider now returns word timings. `WHISPER_MODELS` point at the `_timestamped` onnx-community exports, the worker asks for `return_timestamps: 'word'`, merges words across chunk overlaps, and derives `segments` from the words. Captions built from a transcript keep zero-length words instead of dropping them. `find_retakes` says when captions carry segment timing only.
