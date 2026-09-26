# @mcut/transcription-local

## 1.0.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.20

## 1.0.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.19

## 1.0.0-alpha.21

### Patch Changes

- Updated dependencies [[`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150)]:
  - @mcut/transcription@0.1.0-alpha.18

## 1.0.0-alpha.20

### Minor Changes

- [#201](https://github.com/mattppal/mcut/pull/201) [`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366) Thanks [@mattppal](https://github.com/mattppal)! - The on-device Whisper provider now returns word timings. `WHISPER_MODELS` point at the `_timestamped` onnx-community exports, the worker asks for `return_timestamps: 'word'`, merges words across chunk overlaps, and derives `segments` from the words. Captions built from a transcript keep zero-length words instead of dropping them. `find_retakes` says when captions carry segment timing only.

### Patch Changes

- Updated dependencies [[`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366), [`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366)]:
  - @mcut/transcription@0.1.0-alpha.17

## 1.0.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.16

## 1.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.15

## 1.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.14

## 1.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.13

## 1.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.12

## 1.0.0-alpha.14

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.11

## 1.0.0-alpha.13

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.10

## 1.0.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.9

## 1.0.0-alpha.11

### Patch Changes

- Updated dependencies [[`d8d259b`](https://github.com/mattppal/mcut/commit/d8d259b1b390ff12eb0bacb5bfaa4449fe6ce3a2)]:
  - @mcut/transcription@0.1.0-alpha.8

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.7

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.6

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.5

## 0.1.0-alpha.7

### Patch Changes

- [#163](https://github.com/mattppal/mcut/pull/163) [`9bef9e2`](https://github.com/mattppal/mcut/commit/9bef9e244af412f8385d15e96fd99beb0af4d4d9) Thanks [@mattppal](https://github.com/mattppal)! - Time out a stalled Whisper model load and restart the worker after any load failure, so every waiting transcription settles with the model-load error instead of hanging.

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.4

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.3

## 0.1.0-alpha.5

### Patch Changes

- [#144](https://github.com/mattppal/mcut/pull/144) [`70d0aac`](https://github.com/mattppal/mcut/commit/70d0aacc5364e6d966778c0a6ab2aa3dccfb0ee7) Thanks [@mattppal](https://github.com/mattppal)! - A failed Whisper model load no longer poisons the worker. The next `transcribe` call downloads again instead of replaying the first failure, and the error names the model and the host it was fetched from instead of a bare `Failed to fetch`.

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies []:
  - @mcut/transcription@0.1.0-alpha.2

## 0.1.0-alpha.3

### Patch Changes

- [#122](https://github.com/mattppal/mcut/pull/122) [`bf02883`](https://github.com/mattppal/mcut/commit/bf028830b0d37012f937ac3764db6cb355359d32) Thanks [@mattppal](https://github.com/mattppal)! - Aggregated Whisper download progress no longer locks at 100% after the first small model file completes, and a rejected `navigator.gpu.requestAdapter()` falls back to `wasm` instead of failing the transcription.

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
