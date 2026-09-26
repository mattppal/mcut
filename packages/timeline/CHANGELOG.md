# @mcut/timeline

## 0.1.0-alpha.15

### Patch Changes

- [#199](https://github.com/mattppal/mcut/pull/199) [`d9c79e8`](https://github.com/mattppal/mcut/commit/d9c79e82e236119e64192b02ece2529e1cac6a38) Thanks [@mattppal](https://github.com/mattppal)! - A multicam zoom region with no `source` now zooms the whole composite, overlays included, instead of being rejected.

## 0.1.0-alpha.14

### Patch Changes

- [#198](https://github.com/mattppal/mcut/pull/198) [`8e23a05`](https://github.com/mattppal/mcut/commit/8e23a054f987d7cdb3deef7866517164c63c351e) Thanks [@mattppal](https://github.com/mattppal)! - Say when selected clips do not overlap in time, and tell the caller to stack clips recorded together on separate tracks.

## 0.1.0-alpha.13

### Patch Changes

- [#197](https://github.com/mattppal/mcut/pull/197) [`fa6f581`](https://github.com/mattppal/mcut/commit/fa6f581da9ce078b05916c46bfa5159e61b341a5) Thanks [@mattppal](https://github.com/mattppal)! - `createMulticam` keeps the sync of a clip placed after the others. Each source offset is that clip's media time at timeline 0 relative to the earliest source, and the multicam covers the span every source is placed on.

## 0.1.0-alpha.12

### Minor Changes

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - A layout slot takes the frame style of a video clip, with `crop`, `cornerRadius`, `stroke`, and `shadow`. The slot `focus` and the boolean `shadow` are removed, and the v1 to v2 migration turns `shadow: true` into the shadow it drew. The compositor draws video clips and layout slots through one framed media path, and a multicam's own crop and corner radius frame its composite.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - `saveLayout` merges each slot by source into the saved slot. An omitted field keeps its value, `null` clears a frame style field, and `rect` is required only for a source new to the layout, so re-saving a slot with a new rect keeps its corner radius and shadow. An overlay slot new to a layout that sets none of `cornerRadius`, `stroke`, and `shadow` gets the picture-in-picture look, a 0.12 corner radius and a soft shadow sized to the slot. The `saveLayout` and `resizeLayoutSlot` tool results list each style change field by field and warn when an overlay loses its corner radius or its shadow.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - A multicam is a media clip. It shares `trimStartMs`, `timeMap`, `reversed`, volume, mute, and fades with video and audio elements, so trims, splits, slips, speed changes, reverse, `detachAudio`, `removeAsset`, and motion blur presets treat it like a video clip. Each source carries `offsetMs`, its media time at source clock 0. Angle cuts sit on that source clock, so a cut stays on the same content through every window edit.

  Breaking changes follow. `createMulticam` takes `sources: [{ elementId, key? }]` and an optional `audioSource`, accepts audio elements as audio-only sources, and syncs the sources as placed on the timeline. `setMulticamSourceTrim` is now `setMulticamSourceOffset { sourceKey, offsetMs }`. `angles[].atMs` and every angle command time are on the source clock. `PROJECT_VERSION` is 2, and `parseProject` migrates v1 documents. `splitAngles`, `getMulticamAudioSource`, and `ElementAudioSourceType` are removed, and `ElementAudioSource` drops `elementType` and `multicamSourceKey`. The media context reports multicam source `offsetMs` and counts only the angle spans a clip plays.

  New exports are `MediaClip`, `isMediaClip`, `getMediaSourceDurationMs`, `getElementAssetIds`, `getMulticamGroupTimeMs`, `getVisibleAngleCuts`, `isAudioOnlySource`, and `getLocalTimeMs`.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - A multicam slot zoom frames inside the slot's crop. The slot's cover or contain fit is measured over its crop, the zoom scales that fit, and the target lands inside the crop window, so a zoom never shows source the crop cuts away. Outside a zoom, `getSlotView` returns the center at scale 1, because the slot's crop now sets its framing. Zoom `focus` and `rect` are 0 to 1 across the cropped frame of the clip or slot. `VisibleFraction`, the type of the `visible` argument of `getSlotView`, is exported.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - A reframe track on a multicam source slides the crop of every slot that shows the source onto the subject, so a tight face crop follows the face. Once the crop meets the frame edge, the part the slot's fit shows keeps moving toward the subject inside the crop. `getSlotView` takes a `rest` focus, the view outside a zoom and where a zoom starts, and the compositor passes the reframed focus there.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - Add the `resizeLayoutSlot` command. It resizes one layout slot around an anchor by aspect, pixel size, or scale, so the slot keeps its place instead of jumping to another corner. The MCP tool result shows each slot before and after the resize, as it does for `saveLayout`.

### Patch Changes

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - `flattenMulticam` copies each source's `reframe` track onto every video clip cut from that source, so a flattened camera keeps following the person. The track is keyed by the source's media time, which the clip shares, so it copies without retiming.

## 0.1.0-alpha.11

### Patch Changes

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - The `detailZoom` preset now zooms to 1.3x instead of 1.5x, so a detail punch-in stays subtle. The `addZoomRegion` preset description and the `edit_zooms` tool description say 1.3x.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - `flattenMulticam` now keeps zoom regions. A zoom on a source moves onto each clip cut from that source, in that clip's time, and zooms on other sources drop. A zoom that spans an angle cut is copied onto the clip after the cut with `-r` appended to its id.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - `EditorEngine.transact` now rolls back when its function throws. The project and selection return to where that `transact` began and no undo step is recorded, so `edit_zooms`, `apply_commands`, and `apply_captions` apply all of their commands or none. A nested `transact` that throws rolls back only its own dispatches.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - `updateElement` and `addElement` now reject a `zooms` array whose zooms overlap on one target, the rule `addZoomRegion` and `updateZoomRegion` already enforce. A `transact` that writes `zooms` through `updateElement` gets the same check.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - A zoom `rect` now aims at its center and fills it only up to the preset scale, so a region never makes a detail zoom severe. MCP zoom edits warn when any zoom goes above 1.5x.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - A split, insert edit, or overwrite edit through a zoom region now gives the right piece's copy the zoom id with `-r` appended, so the two pieces no longer share an id. `listZoomRegions` cuts each region's timeline `startMs` and `endMs` at its element's edges, and `summarizeProject` prints that start, so `list_zooms` and `get_summary` show the part of the zoom each piece plays.

## 0.1.0-alpha.10

### Minor Changes

- [#180](https://github.com/mattppal/mcut/pull/180) [`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928) Thanks [@mattppal](https://github.com/mattppal)! - Add center person reframing. A video or one multicam source can carry a reframe track of subject centers keyed by asset media time, so trims, splits, slips, and speed changes keep the framing on the subject. Adds the `setReframe` command, `getReframeCenter`, `centeredFocus`, and the `VisibleFraction` type that `centeredFocus` and `getSlotView` take. The compositor slides a video crop or a cover slot window onto the subject, and a zoom region narrows from that reframed window. Adds `planCenterPerson`, which turns face samples into a smoothed and simplified `setReframe` command. On a video whose crop matches the project aspect within 1%, the plan also carries an `updateElement` that scales the clip to fill the frame, and the `fill` option forces or disables that.

## 0.1.0-alpha.9

### Patch Changes

- [#179](https://github.com/mattppal/mcut/pull/179) [`9f1ebce`](https://github.com/mattppal/mcut/commit/9f1ebce07c0d449e6818951fabb61668b27852e2) Thanks [@mattppal](https://github.com/mattppal)! - `cancelTransaction` rolls back only the innermost open transaction and leaves any outer transaction open. It used to cancel every open level, so a failed MCP `transact` in Studio also discarded a text edit in progress. `loadProject` keeps open transactions open and restarts them from the loaded project.

## 0.1.0-alpha.8

### Minor Changes

- [#161](https://github.com/mattppal/mcut/pull/161) [`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d) Thanks [@mattppal](https://github.com/mattppal)! - Video, audio, and multicam clips can store an optional voice cleanup mix. The Clean up voice operator toggles that mix on the current selection in one undo step. Export and preview accept a replacement audio URL per clip so a cleaned stem can stand in for the clip's original audio.

## 0.1.0-alpha.7

### Minor Changes

- [#165](https://github.com/mattppal/mcut/pull/165) [`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33) Thanks [@mattppal](https://github.com/mattppal)! - Add `planZoomRegionDrag` and `planZoomAtPlayhead` to `@mcut/editor`, the headless planners behind the Studio zoom lane. A drag moves the whole zoom, its start, the inner edge of either ramp, or its end. Every drag keeps valid ramp and hold lengths, and a move or outer edge drag also stops at the element edges and at neighboring zooms on its target. `planZoomAtPlayhead` starts a preset or an explicit zoom shape at the playhead and picks the `screen` source on a multicam. `@mcut/timeline` now exports `isZoomable`, `ZoomableElement`, and `zoomRegionEndMs`.

### Patch Changes

- [#165](https://github.com/mattppal/mcut/pull/165) [`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33) Thanks [@mattppal](https://github.com/mattppal)! - Remove the keyframe zoom presets in favor of zoom regions. The `applyZoomPreset` command is gone, along with `ZOOM_PRESETS`, `ZOOMABLE_PROPERTIES`, `zoomPresetSchema`, `ZoomPreset`, `expandZoomPreset`, and `captureZoomPreset`. Add a punch-in with `addZoomRegion` instead.

## 0.1.0-alpha.6

### Minor Changes

- [#154](https://github.com/mattppal/mcut/pull/154) [`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f) Thanks [@mattppal](https://github.com/mattppal)! - Add `easeInExpo`, `easeOutExpo`, and `easeInOutExpo` to `easingSchema`.

- [#154](https://github.com/mattppal/mcut/pull/154) [`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f) Thanks [@mattppal](https://github.com/mattppal)! - Add zoom regions, one punch-in object with in, hold, and out timing, a target, easing, and motion blur, on a clip or on one multicam source. Adds the `addZoomRegion`, `updateZoomRegion`, and `removeZoomRegion` commands, `getSlotView` and `getClipView`, compositor rendering with motion blur while a zoom moves, and the `list_zooms` and `edit_zooms` MCP tools.

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
