---
"@mcut/media": minor
---

`createLocalFaceDetector()` finds the largest face in a video on device. `detect(src)` samples the video at `sampleRateHz` (5 by default), runs the YuNet 2023mar model with `onnxruntime-web` in a module worker, and resolves to one `FaceSample` per sample whose `box` is in fractions of the source frame, or `null` when no face scores at least 0.6. The model downloads once from Hugging Face into Cache Storage. Pass `ortWasmPaths` to serve the onnxruntime wasm from your own origin instead of jsDelivr. Aborting the `signal` terminates the worker, and the next call starts a fresh one.
