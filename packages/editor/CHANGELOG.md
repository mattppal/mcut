# @mcut/editor

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies [[`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1), [`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1)]:
  - @mcut/timeline@0.1.0-alpha.16

## 0.1.0-alpha.16

### Minor Changes

- [#188](https://github.com/mattppal/mcut/pull/188) [`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150) Thanks [@mattppal](https://github.com/mattppal)! - Silence cuts, captions scoped to a clip, and audio activity read the clip's audio source, so a multicam uses its `audioSource` instead of being rejected as the wrong element type. A multicam with no audio source fails until `setMulticamAudio`. Reverse and trim-to-playhead treat a multicam as a media clip.

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies [[`d9c79e8`](https://github.com/mattppal/mcut/commit/d9c79e82e236119e64192b02ece2529e1cac6a38)]:
  - @mcut/timeline@0.1.0-alpha.15

## 0.1.0-alpha.14

### Patch Changes

- Updated dependencies [[`8e23a05`](https://github.com/mattppal/mcut/commit/8e23a054f987d7cdb3deef7866517164c63c351e)]:
  - @mcut/timeline@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies [[`fa6f581`](https://github.com/mattppal/mcut/commit/fa6f581da9ce078b05916c46bfa5159e61b341a5)]:
  - @mcut/timeline@0.1.0-alpha.13

## 0.1.0-alpha.12

### Minor Changes

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - Timeline gestures clamp a multicam like a video clip, from its trim, speed, reverse, and source coverage. Create from selection passes selected audio clips as audio-only sources. Lint checks the angle cuts inside a multicam's window and every asset an element references, including multicam sources, so `mcut lint` reports a missing source asset. The `multicam-first-angle` and `angle-beyond-end` lint codes are removed, because cuts outside the window are expected after a split or a trim.

### Patch Changes

- Updated dependencies [[`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b)]:
  - @mcut/timeline@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - `planZoomRegionDrag` returns the zoom unchanged when no drag of the requested kind can fit it in its piece, such as a zoom left longer than a split piece. It used to return a timing with a negative `atMs` or one `updateZoomRegion` rejects.

- Updated dependencies [[`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78)]:
  - @mcut/timeline@0.1.0-alpha.11

## 0.1.0-alpha.10

### Minor Changes

- [#180](https://github.com/mattppal/mcut/pull/180) [`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928) Thanks [@mattppal](https://github.com/mattppal)! - Add center person reframing. A video or one multicam source can carry a reframe track of subject centers keyed by asset media time, so trims, splits, slips, and speed changes keep the framing on the subject. Adds the `setReframe` command, `getReframeCenter`, `centeredFocus`, and the `VisibleFraction` type that `centeredFocus` and `getSlotView` take. The compositor slides a video crop or a cover slot window onto the subject, and a zoom region narrows from that reframed window. Adds `planCenterPerson`, which turns face samples into a smoothed and simplified `setReframe` command. On a video whose crop matches the project aspect within 1%, the plan also carries an `updateElement` that scales the clip to fill the frame, and the `fill` option forces or disables that.

### Patch Changes

- Updated dependencies [[`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928)]:
  - @mcut/timeline@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies [[`9f1ebce`](https://github.com/mattppal/mcut/commit/9f1ebce07c0d449e6818951fabb61668b27852e2)]:
  - @mcut/timeline@0.1.0-alpha.9

## 0.1.0-alpha.8

### Minor Changes

- [#161](https://github.com/mattppal/mcut/pull/161) [`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d) Thanks [@mattppal](https://github.com/mattppal)! - Video, audio, and multicam clips can store an optional voice cleanup mix. The Clean up voice operator toggles that mix on the current selection in one undo step. Export and preview accept a replacement audio URL per clip so a cleaned stem can stand in for the clip's original audio.

### Patch Changes

- Updated dependencies [[`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d)]:
  - @mcut/timeline@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- [#165](https://github.com/mattppal/mcut/pull/165) [`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33) Thanks [@mattppal](https://github.com/mattppal)! - Add `planZoomRegionDrag` and `planZoomAtPlayhead` to `@mcut/editor`, the headless planners behind the Studio zoom lane. A drag moves the whole zoom, its start, the inner edge of either ramp, or its end. Every drag keeps valid ramp and hold lengths, and a move or outer edge drag also stops at the element edges and at neighboring zooms on its target. `planZoomAtPlayhead` starts a preset or an explicit zoom shape at the playhead and picks the `screen` source on a multicam. `@mcut/timeline` now exports `isZoomable`, `ZoomableElement`, and `zoomRegionEndMs`.

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

### Minor Changes

- [#159](https://github.com/mattppal/mcut/pull/159) [`9b17ac7`](https://github.com/mattppal/mcut/commit/9b17ac71a1314a9197d350ae110783537b13243a) Thanks [@mattppal](https://github.com/mattppal)! - `applyAnimationPreset` takes an element-local `atMs`. In and emphasis presets start there, out presets end there, clamped to fit the clip. `withPlayheadDefaults` fills `atMs` from the playhead when the playhead is on the clip, and the MCP server and `applyCommands` use it.

### Patch Changes

- Updated dependencies [[`9b17ac7`](https://github.com/mattppal/mcut/commit/9b17ac71a1314a9197d350ae110783537b13243a)]:
  - @mcut/timeline@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [[`e50b13b`](https://github.com/mattppal/mcut/commit/e50b13b76ecfb5dc8e75ffa3d01625b644c84a33)]:
  - @mcut/timeline@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- [#29](https://github.com/mattppal/mcut/pull/29) [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78) Thanks [@mattppal](https://github.com/mattppal)! - Add grouped timeline elements and editable sequential video collage primitives with grouped canvas transforms, plus stable export frame snapshots for repeated collage draws.

### Patch Changes

- [#58](https://github.com/mattppal/mcut/pull/58) [`187afb7`](https://github.com/mattppal/mcut/commit/187afb714bc18d72bed179cd7a46be83a3aa13b6) Thanks [@mattppal](https://github.com/mattppal)! - Operators that reject their input now throw `OperatorError` with a code (`unknown-asset`, `unknown-element`, `invalid-payload`, `unsupported`, `out-of-bounds`) instead of a plain `Error`, so MCP clients get `OperatorError (code): message` for `media.insertAssetAtPlayhead`, the multicam asset checks, and silence cuts.

- [#93](https://github.com/mattppal/mcut/pull/93) [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46) Thanks [@mattppal](https://github.com/mattppal)! - Format sources with oxfmt.

- [#63](https://github.com/mattppal/mcut/pull/63) [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0) Thanks [@mattppal](https://github.com/mattppal)! - Element, effect, transition, container, and renderer registries are now closed tables. `registerElement`, `registerEffect`, and the other register functions are removed. `engine.dispatch` takes `BuiltinCommand`.

- [#64](https://github.com/mattppal/mcut/pull/64) [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a) Thanks [@mattppal](https://github.com/mattppal)! - Split the timeline command reducers into domain modules behind the same `commands` entry and route magnetic and gapped placement through one policy, with no change to command behavior.

- [#67](https://github.com/mattppal/mcut/pull/67) [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1) Thanks [@mattppal](https://github.com/mattppal)! - Replace internal non-null assertions and type casts with constructed shapes, typed lookups, and checked accessors; no behavior change.

- [#66](https://github.com/mattppal/mcut/pull/66) [`3aefe7a`](https://github.com/mattppal/mcut/commit/3aefe7ad15084d9f6aa5a9a68f9edb63bffcbdde) Thanks [@mattppal](https://github.com/mattppal)! - The editor operator registry is now a closed table. `EditorOperatorRegistry`, `createEditorOperatorRegistry`, and `registerCoreOperators` are removed in favor of `operators`, `OperatorId`, `parseOperatorId`, `listOperators`, and `runOperator`. Captions, silence cuts, lint, and platform presets moved out of the CLI into `@mcut/editor` and `@mcut/transcription` as pure functions with zod input schemas, and the MCP server exposes them as the `apply_captions`, `apply_silence_cuts`, `lint_project`, and `list_presets` tools. `McutMcpTarget` gains `applyCommands`, and the `operators` option on `createMcutMcpServer` is gone.

- [#79](https://github.com/mattppal/mcut/pull/79) [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7) Thanks [@mattppal](https://github.com/mattppal)! - Remove internal comments and keep the constraints they described as names, types, and tests; no behavior change.

- Updated dependencies [[`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b), [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc), [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78), [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a), [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1), [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7)]:
  - @mcut/timeline@0.1.0-alpha.1
