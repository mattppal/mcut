# @mcut/timeline

## 0.1.0-alpha.5

### Patch Changes

- [#156](https://github.com/mattppal/mcut/pull/156) [`53b78d7`](https://github.com/mattppal/mcut/commit/53b78d7fdaaeed29df8d1654702d073eacf75e65) Thanks [@mattppal](https://github.com/mattppal)! - `run_action` and `list_actions` name `file.export-video` for export. `apply_captions` warns when its transcript matches no captions in the project, so invented transcripts are visible, and it now fails without touching existing captions when the transcript yields no captions. `applyAnimationPreset` points to `effects.fade-open-close` for a fade in and out as one undo step.

## 0.1.0-alpha.4

### Minor Changes

- [#155](https://github.com/mattppal/mcut/pull/155) [`b6f0765`](https://github.com/mattppal/mcut/commit/b6f07651f745e393b59e5db6dbc4e67f370939b3) Thanks [@mattppal](https://github.com/mattppal)! - The project summary lists each layout by role (picture-in-picture, full-frame, split) with every slot's pixel size and aspect. A `saveLayout` tool result shows each slot before and after with width and height change, and warns when a full-frame layout's only slot stops covering the frame.

## 0.1.0-alpha.3

### Minor Changes

- [#159](https://github.com/mattppal/mcut/pull/159) [`9b17ac7`](https://github.com/mattppal/mcut/commit/9b17ac71a1314a9197d350ae110783537b13243a) Thanks [@mattppal](https://github.com/mattppal)! - `applyAnimationPreset` takes an element-local `atMs`. In and emphasis presets start there, out presets end there, clamped to fit the clip. `withPlayheadDefaults` fills `atMs` from the playhead when the playhead is on the clip, and the MCP server and `applyCommands` use it.

## 0.1.0-alpha.2

### Patch Changes

- [#96](https://github.com/mattppal/mcut/pull/96) [`e50b13b`](https://github.com/mattppal/mcut/commit/e50b13b76ecfb5dc8e75ffa3d01625b644c84a33) Thanks [@mattppal](https://github.com/mattppal)! - `transformSchema` rejects unknown keys. A transform patch such as `{ position, scale }` now fails with a typed error instead of parsing to the identity transform.

## 0.1.0-alpha.1

### Minor Changes

- [#19](https://github.com/mattppal/mcut/pull/19) [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad) Thanks [@mattppal](https://github.com/mattppal)! - Add a default Screen + Cam 3:4 multicam crop layout preset.

- [#29](https://github.com/mattppal/mcut/pull/29) [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78) Thanks [@mattppal](https://github.com/mattppal)! - Add grouped timeline elements and editable sequential video collage primitives with grouped canvas transforms, plus stable export frame snapshots for repeated collage draws.

### Patch Changes

- [#61](https://github.com/mattppal/mcut/pull/61) [`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b) Thanks [@mattppal](https://github.com/mattppal)! - `captionWordSchema` now requires `endMs >= startMs`, so an inverted word is rejected at `addElement` and `applyCaptions` instead of producing a negative `endMs` after a trim that `parseProject` rejects.

- [#57](https://github.com/mattppal/mcut/pull/57) [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc) Thanks [@mattppal](https://github.com/mattppal)! - `splitElement`, `createMulticam`, `detachAudio`, and `applyCaptions` now reject a caller-supplied element id that already exists with `CommandError` code `duplicate-element`, matching `addElement`.

- [#59](https://github.com/mattppal/mcut/pull/59) [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7) Thanks [@mattppal](https://github.com/mattppal)! - `trimEdge`, `rippleTrim`, `rollEdit`, and `slideElement` now reject a `deltaMs` whose resulting duration leaves the safe integer range with `CommandError` code `out-of-bounds`, instead of writing a `durationMs` that `parseProject` rejects.

- [#19](https://github.com/mattppal/mcut/pull/19) [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad) Thanks [@mattppal](https://github.com/mattppal)! - Add `resolveElementAudioSource` for resolving playable audio sources from video, audio, and multicam timeline elements.

- [#93](https://github.com/mattppal/mcut/pull/93) [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46) Thanks [@mattppal](https://github.com/mattppal)! - Format sources with oxfmt.

- [#60](https://github.com/mattppal/mcut/pull/60) [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a) Thanks [@mattppal](https://github.com/mattppal)! - Splitting or edge-trimming a reversed clip with a `timeMap` now writes an integer `trimStartMs` on the left half, so the project still passes `parseProject`.

- [#56](https://github.com/mattppal/mcut/pull/56) [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3) Thanks [@mattppal](https://github.com/mattppal)! - `applyThumbnail` now puts each text layer of a thumbnail template on its own locked "Thumbnail" track, so the layers no longer overlap on one track and every layer stays editable with `updateElement` and `moveElement`. `findThumbnailTrack` is replaced by `findThumbnailTracks`.

- [#63](https://github.com/mattppal/mcut/pull/63) [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0) Thanks [@mattppal](https://github.com/mattppal)! - Element, effect, transition, container, and renderer registries are now closed tables. `registerElement`, `registerEffect`, and the other register functions are removed. `engine.dispatch` takes `BuiltinCommand`.

- [#64](https://github.com/mattppal/mcut/pull/64) [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a) Thanks [@mattppal](https://github.com/mattppal)! - Split the timeline command reducers into domain modules behind the same `commands` entry and route magnetic and gapped placement through one policy, with no change to command behavior.

- [#67](https://github.com/mattppal/mcut/pull/67) [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1) Thanks [@mattppal](https://github.com/mattppal)! - Replace internal non-null assertions and type casts with constructed shapes, typed lookups, and checked accessors; no behavior change.

- [#79](https://github.com/mattppal/mcut/pull/79) [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7) Thanks [@mattppal](https://github.com/mattppal)! - Remove internal comments and keep the constraints they described as names, types, and tests; no behavior change.
