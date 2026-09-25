# @mcut/compositor

## 0.1.0-alpha.12

### Minor Changes

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - A layout slot takes the frame style of a video clip, with `crop`, `cornerRadius`, `stroke`, and `shadow`. The slot `focus` and the boolean `shadow` are removed, and the v1 to v2 migration turns `shadow: true` into the shadow it drew. The compositor draws video clips and layout slots through one framed media path, and a multicam's own crop and corner radius frame its composite.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - A reframe track on a multicam source slides the crop of every slot that shows the source onto the subject, so a tight face crop follows the face. Once the crop meets the frame edge, the part the slot's fit shows keeps moving toward the subject inside the crop. `getSlotView` takes a `rest` focus, the view outside a zoom and where a zoom starts, and the compositor passes the reframed focus there.

### Patch Changes

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - Multicam angle transitions blend on the source clock, so a trimmed, slipped, or sped-up multicam blends at its cuts. A layout slot that names an audio-only source draws nothing.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - A multicam slot zoom frames inside the slot's crop. The slot's cover or contain fit is measured over its crop, the zoom scales that fit, and the target lands inside the crop window, so a zoom never shows source the crop cuts away. Outside a zoom, `getSlotView` returns the center at scale 1, because the slot's crop now sets its framing. Zoom `focus` and `rect` are 0 to 1 across the cropped frame of the clip or slot. `VisibleFraction`, the type of the `visible` argument of `getSlotView`, is exported.

- Updated dependencies [[`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b)]:
  - @mcut/timeline@0.1.0-alpha.12

## 0.1.0-alpha.11

### Minor Changes

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - `RenderFrameOptions.renderScale` renders motion blur samples at that fraction of the project resolution and composites them over the whole frame. It defaults to 1, so export and every other caller keep full-resolution samples.

### Patch Changes

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

### Patch Changes

- Updated dependencies [[`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d)]:
  - @mcut/timeline@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies [[`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33), [`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33)]:
  - @mcut/timeline@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- [#154](https://github.com/mattppal/mcut/pull/154) [`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f) Thanks [@mattppal](https://github.com/mattppal)! - Add zoom regions, one punch-in object with in, hold, and out timing, a target, easing, and motion blur, on a clip or on one multicam source. Adds the `addZoomRegion`, `updateZoomRegion`, and `removeZoomRegion` commands, `getSlotView` and `getClipView`, compositor rendering with motion blur while a zoom moves, and the `list_zooms` and `edit_zooms` MCP tools.

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

- [#67](https://github.com/mattppal/mcut/pull/67) [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1) Thanks [@mattppal](https://github.com/mattppal)! - Replace internal non-null assertions and type casts with constructed shapes, typed lookups, and checked accessors; no behavior change.

- [#33](https://github.com/mattppal/mcut/pull/33) [`5f1cae7`](https://github.com/mattppal/mcut/commit/5f1cae7ccd6326366bc680e59a6f1226be620588) Thanks [@mattppal](https://github.com/mattppal)! - Rewrite package descriptions in plain prose.

- [#79](https://github.com/mattppal/mcut/pull/79) [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7) Thanks [@mattppal](https://github.com/mattppal)! - Remove internal comments and keep the constraints they described as names, types, and tests; no behavior change.

- [#13](https://github.com/mattppal/mcut/pull/13) [`b0d4b0e`](https://github.com/mattppal/mcut/commit/b0d4b0eaf704ac2e127213f84d4c5afd5b42c9f4) Thanks [@mattppal](https://github.com/mattppal)! - Default `PlayerCanvas` preview rendering to the WebGPU compositor where supported, with Canvas2D fallback when WebGPU initialization fails.

  Update compositor metadata and docs to describe both the Canvas2D reference renderer and WebGPU backend.

- Updated dependencies [[`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b), [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc), [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78), [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a), [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1), [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7)]:
  - @mcut/timeline@0.1.0-alpha.1
