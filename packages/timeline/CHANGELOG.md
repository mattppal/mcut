# @mcut/timeline

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
