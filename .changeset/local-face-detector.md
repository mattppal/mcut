---
"@mcut/media": minor
---

`createLocalFaceDetector()` detects faces in a video on the user's device. `detect(src)` samples the video `sampleRateHz` times per second, 5 by default, and runs the YuNet 2023mar model with `onnxruntime-web` in a module worker. It resolves to one `FaceSample` per sample. Each sample's `box` is the largest face in fractions of the source frame, or `null` when no face scores at least 0.6. The model downloads once from Hugging Face into Cache Storage. Pass `ortWasmPaths` to serve the onnxruntime wasm from your own origin instead of jsDelivr. Aborting the `signal` terminates the worker, and the next call starts a fresh one.
