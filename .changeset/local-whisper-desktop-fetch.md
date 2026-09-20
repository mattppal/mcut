---
"@mcut/transcription-local": minor
---

`createLocalWhisperProvider` accepts `ortWasmPaths` so an app can serve the onnxruntime-web WASM from its own origin instead of jsDelivr, falls back from `webgpu` to `wasm` when `navigator.gpu.requestAdapter()` returns no adapter, reports model download progress aggregated across all model files, and posts a `transcribe` progress of 0 as soon as the model is ready. Transformers.js moves to 4.3.0, whose onnxruntime no longer fails session creation on the `q8` Whisper decoders (onnxruntime issue 28306).
