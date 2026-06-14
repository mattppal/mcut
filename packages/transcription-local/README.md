# @mcut/transcription-local

On-device Whisper transcription provider for mcut.

```sh
bun add @mcut/transcription-local @mcut/transcription
```

This package runs local transcription through Transformers.js in a browser
worker. It includes chunk planning, repetition guards, VAD helpers, and a
self-contained worker bundle for WebGPU-capable browser environments.
