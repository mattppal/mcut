# @mcut/transcription

## 0.1.0-alpha.23

### Patch Changes

- Updated dependencies [[`46f3ce3`](https://github.com/mattppal/mcut/commit/46f3ce34f1a9284df47e6de48958011f46c829a4)]:
  - @mcut/timeline@0.1.0-alpha.20

## 0.1.0-alpha.22

### Patch Changes

- Updated dependencies [[`1fab6ca`](https://github.com/mattppal/mcut/commit/1fab6cada1e1310f196b7f05e49cf15145cad849)]:
  - @mcut/timeline@0.1.0-alpha.19

## 0.1.0-alpha.21

### Patch Changes

- Updated dependencies [[`ec1f719`](https://github.com/mattppal/mcut/commit/ec1f719b9a09f82dd95d548ec4a44f989895e8de)]:
  - @mcut/timeline@0.1.0-alpha.18

## 0.1.0-alpha.20

### Patch Changes

- Updated dependencies [[`74b5c22`](https://github.com/mattppal/mcut/commit/74b5c22a2c48244113e77ca5f3e03a1c23b80774)]:
  - @mcut/timeline@0.1.0-alpha.17

## 0.1.0-alpha.19

### Patch Changes

- Updated dependencies [[`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1), [`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1)]:
  - @mcut/timeline@0.1.0-alpha.16

## 0.1.0-alpha.18

### Minor Changes

- [#188](https://github.com/mattppal/mcut/pull/188) [`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150) Thanks [@mattppal](https://github.com/mattppal)! - Silence cuts, captions scoped to a clip, and audio activity read the clip's audio source, so a multicam uses its `audioSource` instead of being rejected as the wrong element type. A multicam with no audio source fails until `setMulticamAudio`. Reverse and trim-to-playhead treat a multicam as a media clip.

## 0.1.0-alpha.17

### Patch Changes

- [#201](https://github.com/mattppal/mcut/pull/201) [`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366) Thanks [@mattppal](https://github.com/mattppal)! - `findRetakes` tolerates one dropped or inserted word inside a matched opening, so "hopefully take this as an example" still matches its retake "hopefully you take this as an example". Only matched words count toward `minMatchWords`.

- [#201](https://github.com/mattppal/mcut/pull/201) [`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366) Thanks [@mattppal](https://github.com/mattppal)! - The on-device Whisper provider now returns word timings. `WHISPER_MODELS` point at the `_timestamped` onnx-community exports, the worker asks for `return_timestamps: 'word'`, merges words across chunk overlaps, and derives `segments` from the words. Captions built from a transcript keep zero-length words instead of dropping them. `find_retakes` says when captions carry segment timing only.

## 0.1.0-alpha.16

### Patch Changes

- Updated dependencies [[`d9c79e8`](https://github.com/mattppal/mcut/commit/d9c79e82e236119e64192b02ece2529e1cac6a38)]:
  - @mcut/timeline@0.1.0-alpha.15

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies [[`8e23a05`](https://github.com/mattppal/mcut/commit/8e23a054f987d7cdb3deef7866517164c63c351e)]:
  - @mcut/timeline@0.1.0-alpha.14

## 0.1.0-alpha.14

### Patch Changes

- Updated dependencies [[`fa6f581`](https://github.com/mattppal/mcut/commit/fa6f581da9ce078b05916c46bfa5159e61b341a5)]:
  - @mcut/timeline@0.1.0-alpha.13

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies [[`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b)]:
  - @mcut/timeline@0.1.0-alpha.12

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [[`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78)]:
  - @mcut/timeline@0.1.0-alpha.11

## 0.1.0-alpha.11

### Patch Changes

- Updated dependencies [[`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928)]:
  - @mcut/timeline@0.1.0-alpha.10

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies [[`9f1ebce`](https://github.com/mattppal/mcut/commit/9f1ebce07c0d449e6818951fabb61668b27852e2)]:
  - @mcut/timeline@0.1.0-alpha.9

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies [[`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d)]:
  - @mcut/timeline@0.1.0-alpha.8

## 0.1.0-alpha.8

### Minor Changes

- [#160](https://github.com/mattppal/mcut/pull/160) [`d8d259b`](https://github.com/mattppal/mcut/commit/d8d259b1b390ff12eb0bacb5bfaa4449fe6ce3a2) Thanks [@mattppal](https://github.com/mattppal)! - Add `findRetakes` over word-timed transcripts and the `find_retakes` MCP tool, which returns candidate ranges that keep the last take, last to first. With `elementId` it also returns that clip's transcript in source time, ready to re-caption the clip after the cuts.

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies [[`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33), [`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33)]:
  - @mcut/timeline@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies [[`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f), [`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f)]:
  - @mcut/timeline@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies [[`53b78d7`](https://github.com/mattppal/mcut/commit/53b78d7fdaaeed29df8d1654702d073eacf75e65)]:
  - @mcut/timeline@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies [[`b6f0765`](https://github.com/mattppal/mcut/commit/b6f07651f745e393b59e5db6dbc4e67f370939b3)]:
  - @mcut/timeline@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- Updated dependencies [[`9b17ac7`](https://github.com/mattppal/mcut/commit/9b17ac71a1314a9197d350ae110783537b13243a)]:
  - @mcut/timeline@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [[`e50b13b`](https://github.com/mattppal/mcut/commit/e50b13b76ecfb5dc8e75ffa3d01625b644c84a33)]:
  - @mcut/timeline@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- [#93](https://github.com/mattppal/mcut/pull/93) [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46) Thanks [@mattppal](https://github.com/mattppal)! - Format sources with oxfmt.

- [#63](https://github.com/mattppal/mcut/pull/63) [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0) Thanks [@mattppal](https://github.com/mattppal)! - Element, effect, transition, container, and renderer registries are now closed tables. `registerElement`, `registerEffect`, and the other register functions are removed. `engine.dispatch` takes `BuiltinCommand`.

- [#66](https://github.com/mattppal/mcut/pull/66) [`3aefe7a`](https://github.com/mattppal/mcut/commit/3aefe7ad15084d9f6aa5a9a68f9edb63bffcbdde) Thanks [@mattppal](https://github.com/mattppal)! - The editor operator registry is now a closed table. `EditorOperatorRegistry`, `createEditorOperatorRegistry`, and `registerCoreOperators` are removed in favor of `operators`, `OperatorId`, `parseOperatorId`, `listOperators`, and `runOperator`. Captions, silence cuts, lint, and platform presets moved out of the CLI into `@mcut/editor` and `@mcut/transcription` as pure functions with zod input schemas, and the MCP server exposes them as the `apply_captions`, `apply_silence_cuts`, `lint_project`, and `list_presets` tools. `McutMcpTarget` gains `applyCommands`, and the `operators` option on `createMcutMcpServer` is gone.

- [#52](https://github.com/mattppal/mcut/pull/52) [`804ad84`](https://github.com/mattppal/mcut/commit/804ad84e6a46426b8cef655f97db291a2749e42d) Thanks [@mattppal](https://github.com/mattppal)! - Remove comments from the transcription packages and CLI, keeping constraints in names, types, and tests.

- [#50](https://github.com/mattppal/mcut/pull/50) [`135bdd0`](https://github.com/mattppal/mcut/commit/135bdd05b0954489c9fffcb64fc9517cfe4ffeae) Thanks [@mattppal](https://github.com/mattppal)! - Static MCP tool arguments are parsed with zod before the handler runs and a bad argument is reported by field name, and `@mcut/transcription` exports `transcriptResultSchema` as the source of its `TranscriptResult` type.

- Updated dependencies [[`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b), [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc), [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78), [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a), [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1), [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7)]:
  - @mcut/timeline@0.1.0-alpha.1
