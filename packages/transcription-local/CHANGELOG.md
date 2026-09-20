# @mcut/transcription-local

## 0.1.0-alpha.2

### Minor Changes

- [#118](https://github.com/mattppal/mcut/pull/118) [`53f0773`](https://github.com/mattppal/mcut/commit/53f0773e0c772ae855825606f299aba2341bf2af) Thanks [@mattppal](https://github.com/mattppal)! - `createLocalWhisperProvider` accepts `ortWasmPaths` so an app can serve the onnxruntime-web WASM from its own origin instead of jsDelivr, falls back from `webgpu` to `wasm` when `navigator.gpu.requestAdapter()` returns no adapter, reports model download progress aggregated across all model files, and posts a `transcribe` progress of 0 as soon as the model is ready. Transformers.js moves to 4.3.0, whose onnxruntime no longer fails session creation on the `q8` Whisper decoders (onnxruntime issue 28306).

## 0.1.0-alpha.1

### Patch Changes

- [#93](https://github.com/mattppal/mcut/pull/93) [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46) Thanks [@mattppal](https://github.com/mattppal)! - Format sources with oxfmt.

- [#33](https://github.com/mattppal/mcut/pull/33) [`5f1cae7`](https://github.com/mattppal/mcut/commit/5f1cae7ccd6326366bc680e59a6f1226be620588) Thanks [@mattppal](https://github.com/mattppal)! - Rewrite package descriptions in plain prose.

- [#52](https://github.com/mattppal/mcut/pull/52) [`804ad84`](https://github.com/mattppal/mcut/commit/804ad84e6a46426b8cef655f97db291a2749e42d) Thanks [@mattppal](https://github.com/mattppal)! - Remove comments from the transcription packages and CLI, keeping constraints in names, types, and tests.

- Updated dependencies [[`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`3aefe7a`](https://github.com/mattppal/mcut/commit/3aefe7ad15084d9f6aa5a9a68f9edb63bffcbdde), [`804ad84`](https://github.com/mattppal/mcut/commit/804ad84e6a46426b8cef655f97db291a2749e42d), [`135bdd0`](https://github.com/mattppal/mcut/commit/135bdd05b0954489c9fffcb64fc9517cfe4ffeae)]:
  - @mcut/transcription@0.1.0-alpha.1
