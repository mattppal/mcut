# @mcut/mcp-server

## 0.1.0-alpha.32

### Minor Changes

- [#207](https://github.com/mattppal/mcut/pull/207) [`ec1f719`](https://github.com/mattppal/mcut/commit/ec1f719b9a09f82dd95d548ec4a44f989895e8de) Thanks [@mattppal](https://github.com/mattppal)! - New `removeRanges` command and `remove_ranges` MCP tool. One call removes a list of time ranges, in any order, from every unlocked track and closes the gaps as one undo step, so a multicam, its audio, and its captions stay in sync. `remove_ranges` takes timeline ranges such as `find_retakes` candidates, or source-media ranges of a clip's audio with `time: "source"`. The retake flow is `find_retakes`, then `remove_ranges`, then `apply_captions { elementId, replace: true }`.

### Patch Changes

- Updated dependencies [[`ec1f719`](https://github.com/mattppal/mcut/commit/ec1f719b9a09f82dd95d548ec4a44f989895e8de)]:
  - @mcut/timeline@0.1.0-alpha.18
  - @mcut/editor@0.1.0-alpha.19
  - @mcut/transcription@0.1.0-alpha.21

## 0.1.0-alpha.31

### Patch Changes

- [#206](https://github.com/mattppal/mcut/pull/206) [`b57daea`](https://github.com/mattppal/mcut/commit/b57daea9c55e044f93a00d90c5f18cf2c86365b5) Thanks [@mattppal](https://github.com/mattppal)! - The stored transcript keeps the word order it was given instead of sorting by start time. Whisper can start a word a little before the one ahead of it, and the sorted copy stopped matching the captions made from it, so `apply_captions { elementId }` after a cut refused it.

## 0.1.0-alpha.30

### Patch Changes

- [#205](https://github.com/mattppal/mcut/pull/205) [`6827027`](https://github.com/mattppal/mcut/commit/682702705212c4cdd007e59c6a9ae2ec2ecd7f83) Thanks [@mattppal](https://github.com/mattppal)! - `apply_captions` accepts `elementId` without a `transcript` and reuses the word-timed transcript the server stored for that audio from `ensure_transcript`, `find_retakes`, or an earlier `apply_captions`. After retake cuts, the agent re-captions every piece without writing the transcript back out.

## 0.1.0-alpha.29

### Minor Changes

- [#204](https://github.com/mattppal/mcut/pull/204) [`74b5c22`](https://github.com/mattppal/mcut/commit/74b5c22a2c48244113e77ca5f3e03a1c23b80774) Thanks [@mattppal](https://github.com/mattppal)! - `apply_captions` with `elementId` now captions every piece on that clip's track that plays the same audio, so after retake or silence cuts one call with the full source-time transcript re-captions the whole cut. It replaces only the old captions over pieces the transcript has words for, plus captions over no clip, in one undo step. `scope: "clip"` keeps the old single-clip behavior. `applyCaptions` takes `replaceIds` to remove specific caption elements without a ripple.

  `find_retakes` keeps zero-length words in the transcript it returns, so passing that transcript back to `apply_captions` captions every word.

### Patch Changes

- Updated dependencies [[`74b5c22`](https://github.com/mattppal/mcut/commit/74b5c22a2c48244113e77ca5f3e03a1c23b80774)]:
  - @mcut/timeline@0.1.0-alpha.17
  - @mcut/editor@0.1.0-alpha.18
  - @mcut/transcription@0.1.0-alpha.20

## 0.1.0-alpha.28

### Patch Changes

- Updated dependencies [[`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1), [`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1)]:
  - @mcut/timeline@0.1.0-alpha.16
  - @mcut/editor@0.1.0-alpha.17
  - @mcut/transcription@0.1.0-alpha.19

## 0.1.0-alpha.27

### Minor Changes

- [#188](https://github.com/mattppal/mcut/pull/188) [`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150) Thanks [@mattppal](https://github.com/mattppal)! - Silence cuts, captions scoped to a clip, and audio activity read the clip's audio source, so a multicam uses its `audioSource` instead of being rejected as the wrong element type. A multicam with no audio source fails until `setMulticamAudio`. Reverse and trim-to-playhead treat a multicam as a media clip.

### Patch Changes

- [#188](https://github.com/mattppal/mcut/pull/188) [`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150) Thanks [@mattppal](https://github.com/mattppal)! - `find_retakes` accepts a multicam through its audio source, including each piece left after a cut, and maps each word into that asset's media time. `apply_captions` treats a transcript as the project's when the caption words are that transcript with gaps, and still warns for a different transcript.

- [#188](https://github.com/mattppal/mcut/pull/188) [`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150) Thanks [@mattppal](https://github.com/mattppal)! - The `find_retakes` description says to pass the full, unchanged transcript to `apply_captions` once per remaining clip, never a slice, with `replace` true until a call reports OK. It also says to call `find_retakes` for every other captioned clip on the caption track before cutting and to rebuild each from that saved transcript.

- [#188](https://github.com/mattppal/mcut/pull/188) [`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150) Thanks [@mattppal](https://github.com/mattppal)! - `get_audio_activity` fails with setMulticamAudio when the selected multicam has no audio source, instead of analyzing another clip. With no selection it still uses the first clip that has source audio.

- Updated dependencies [[`937941c`](https://github.com/mattppal/mcut/commit/937941cdcb8aef0b4425a91ba2ab94bc92537150)]:
  - @mcut/editor@0.1.0-alpha.16
  - @mcut/transcription@0.1.0-alpha.18

## 0.1.0-alpha.26

### Patch Changes

- [#201](https://github.com/mattppal/mcut/pull/201) [`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366) Thanks [@mattppal](https://github.com/mattppal)! - The on-device Whisper provider now returns word timings. `WHISPER_MODELS` point at the `_timestamped` onnx-community exports, the worker asks for `return_timestamps: 'word'`, merges words across chunk overlaps, and derives `segments` from the words. Captions built from a transcript keep zero-length words instead of dropping them. `find_retakes` says when captions carry segment timing only.

- Updated dependencies [[`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366), [`3f2951b`](https://github.com/mattppal/mcut/commit/3f2951b3db1b9b21b8ac254b6ae638f01769b366)]:
  - @mcut/transcription@0.1.0-alpha.17

## 0.1.0-alpha.25

### Patch Changes

- [#199](https://github.com/mattppal/mcut/pull/199) [`d9c79e8`](https://github.com/mattppal/mcut/commit/d9c79e82e236119e64192b02ece2529e1cac6a38) Thanks [@mattppal](https://github.com/mattppal)! - A multicam zoom region with no `source` now zooms the whole composite, overlays included, instead of being rejected.

- Updated dependencies [[`d9c79e8`](https://github.com/mattppal/mcut/commit/d9c79e82e236119e64192b02ece2529e1cac6a38)]:
  - @mcut/timeline@0.1.0-alpha.15
  - @mcut/editor@0.1.0-alpha.15
  - @mcut/transcription@0.1.0-alpha.16

## 0.1.0-alpha.24

### Patch Changes

- Updated dependencies [[`8e23a05`](https://github.com/mattppal/mcut/commit/8e23a054f987d7cdb3deef7866517164c63c351e)]:
  - @mcut/timeline@0.1.0-alpha.14
  - @mcut/editor@0.1.0-alpha.14
  - @mcut/transcription@0.1.0-alpha.15

## 0.1.0-alpha.23

### Patch Changes

- Updated dependencies [[`fa6f581`](https://github.com/mattppal/mcut/commit/fa6f581da9ce078b05916c46bfa5159e61b341a5)]:
  - @mcut/timeline@0.1.0-alpha.13
  - @mcut/editor@0.1.0-alpha.13
  - @mcut/transcription@0.1.0-alpha.14

## 0.1.0-alpha.22

### Minor Changes

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - `saveLayout` merges each slot by source into the saved slot. An omitted field keeps its value, `null` clears a frame style field, and `rect` is required only for a source new to the layout, so re-saving a slot with a new rect keeps its corner radius and shadow. An overlay slot new to a layout that sets none of `cornerRadius`, `stroke`, and `shadow` gets the picture-in-picture look, a 0.12 corner radius and a soft shadow sized to the slot. The `saveLayout` and `resizeLayoutSlot` tool results list each style change field by field and warn when an overlay loses its corner radius or its shadow.

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - Add the `resizeLayoutSlot` command. It resizes one layout slot around an anchor by aspect, pixel size, or scale, so the slot keeps its place instead of jumping to another corner. The MCP tool result shows each slot before and after the resize, as it does for `saveLayout`.

### Patch Changes

- Updated dependencies [[`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b)]:
  - @mcut/timeline@0.1.0-alpha.12
  - @mcut/editor@0.1.0-alpha.12
  - @mcut/transcription@0.1.0-alpha.13

## 0.1.0-alpha.21

### Patch Changes

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - The `detailZoom` preset now zooms to 1.3x instead of 1.5x, so a detail punch-in stays subtle. The `addZoomRegion` preset description and the `edit_zooms` tool description say 1.3x.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - `find_retakes` with `elementId` now rejects a clip with a time remap, as it already did a reversed clip. `apply_captions` cannot scope captions to such a clip, so the agent learns this before it cuts anything.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - The `find_retakes` tool description now tells the agent to rebuild captions once per remaining piece of the cut clip, passing `replace` true until a call reports OK. Because that call clears the caption track, the agent also takes a `find_retakes` transcript for every other captioned clip on that track before cutting and rebuilds those clips the same way.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - `EditorEngine.transact` now rolls back when its function throws. The project and selection return to where that `transact` began and no undo step is recorded, so `edit_zooms`, `apply_commands`, and `apply_captions` apply all of their commands or none. A nested `transact` that throws rolls back only its own dispatches.

- [#189](https://github.com/mattppal/mcut/pull/189) [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78) Thanks [@mattppal](https://github.com/mattppal)! - A zoom `rect` now aims at its center and fills it only up to the preset scale, so a region never makes a detail zoom severe. MCP zoom edits warn when any zoom goes above 1.5x.

- Updated dependencies [[`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78)]:
  - @mcut/timeline@0.1.0-alpha.11
  - @mcut/editor@0.1.0-alpha.11
  - @mcut/transcription@0.1.0-alpha.12

## 0.1.0-alpha.20

### Minor Changes

- [#195](https://github.com/mattppal/mcut/pull/195) [`c5aed4a`](https://github.com/mattppal/mcut/commit/c5aed4a4615a3fd5dcb1d76c385cd28ea3574b40) Thanks [@mattppal](https://github.com/mattppal)! - Find where the picture changes with `findSceneChanges`, and render a labelled thumbnail grid with `renderContactSheet`. Both read one video clip or one multicam source over a timeline range. Agents get them as the `find_scene_changes` and `get_contact_sheet` MCP tools on the live Studio bridge.

  `find_scene_changes` compares 64 by 36 luma frames every `stepMs`, reports a change when the changed fraction of the picture passes the `sensitivity` threshold, and refines each change to the exact frame. It returns the changes and the stable segments between them.

  `McutMcpTarget.findSceneChanges` and `getContactSheet` are optional. On a target without them, the tools fail with `find_scene_changes requires the live bridge connected to Studio.` and the same for `get_contact_sheet`.

## 0.1.0-alpha.19

### Patch Changes

- [#191](https://github.com/mattppal/mcut/pull/191) [`5222666`](https://github.com/mattppal/mcut/commit/52226663d12d2ee8ae8b29284d5c216bb6eef5d8) Thanks [@mattppal](https://github.com/mattppal)! - `import_media` expands a leading `~` to the home folder, and its path errors name the resolved absolute path and the home folder.

## 0.1.0-alpha.18

### Minor Changes

- [#168](https://github.com/mattppal/mcut/pull/168) [`670b34b`](https://github.com/mattppal/mcut/commit/670b34b4279a1e3f344674cf8aa2673fdd86c455) Thanks [@mattppal](https://github.com/mattppal)! - Render one project frame to a PNG with `renderProjectStill`, and expose it to agents as the `get_frame` MCP tool on the live Studio bridge.

  `McutMcpTarget.getFrame` is optional, like the other live-only members, so a custom target without it still compiles. `get_frame` on such a target fails with `get_frame requires the live bridge connected to Studio.`

## 0.1.0-alpha.17

### Patch Changes

- [#178](https://github.com/mattppal/mcut/pull/178) [`e5a64fa`](https://github.com/mattppal/mcut/commit/e5a64fabe9118f2ffe032e9e83ff427301a2836e) Thanks [@mattppal](https://github.com/mattppal)! - Fail an export whose Studio socket closes while the job is starting, ignore a replaced tab closing under a newer export, and keep a cancel during the file rename cancelled. The owner is the socket that carried start_export, so a reply crossing a tab swap cannot leave the job rendering, and a start that is still waiting can finish on the reconnected tab.

## 0.1.0-alpha.16

### Minor Changes

- [#180](https://github.com/mattppal/mcut/pull/180) [`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928) Thanks [@mattppal](https://github.com/mattppal)! - Add the `center_person` MCP tool. In a live bridge session it finds the face on device in the connected editor and keeps the person in frame as one undoable edit, on a video crop or on one multicam source, which defaults to `camera`. On a video whose crop matches the project aspect within 1%, it also scales the clip to fill the frame, and the optional `fill` input forces or disables that. It returns the target, the sample and key counts, the source range the keys cover, and whether it filled the frame. The live bridge waits for it as long as for `ensure_transcript`, and a headless server rejects it with a message that a live bridge is required. `McutMcpTarget` gains an optional `centerPerson` method.

### Patch Changes

- Updated dependencies [[`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928)]:
  - @mcut/timeline@0.1.0-alpha.10
  - @mcut/editor@0.1.0-alpha.10
  - @mcut/transcription@0.1.0-alpha.11

## 0.1.0-alpha.15

### Minor Changes

- [#169](https://github.com/mattppal/mcut/pull/169) [`888fa37`](https://github.com/mattppal/mcut/commit/888fa379f17f4607a25ef8f73ff75f09e41d7c05) Thanks [@mattppal](https://github.com/mattppal)! - Import local media into a live Studio project with the `import_media` tool.

### Patch Changes

- [#179](https://github.com/mattppal/mcut/pull/179) [`9f1ebce`](https://github.com/mattppal/mcut/commit/9f1ebce07c0d449e6818951fabb61668b27852e2) Thanks [@mattppal](https://github.com/mattppal)! - `transact` rejects `edit.undo` and `edit.redo` before any call runs, whether they come as `operator_edit_undo`, `operator_edit_redo`, `run_operator`, or `run_action`. They used to run inside the transaction, so one transact could undo an earlier edit and still report one undo step. A failed call whose message already ends in a period no longer reports a double period.

  `McutMcpTarget.transact` is optional, like the other members a custom target may leave out. A target without it keeps compiling, and the `transact` tool fails on it with `transact is not available on this target.`

  The server now sends MCP instructions, and the `transact`, `undo`, `run_operator`, `run_action`, and `apply_commands` descriptions tell agents to send every edit call for one user request in one `transact`, so "undo that" removes the whole request.

- Updated dependencies [[`9f1ebce`](https://github.com/mattppal/mcut/commit/9f1ebce07c0d449e6818951fabb61668b27852e2)]:
  - @mcut/timeline@0.1.0-alpha.9
  - @mcut/editor@0.1.0-alpha.9
  - @mcut/transcription@0.1.0-alpha.10

## 0.1.0-alpha.14

### Patch Changes

- Updated dependencies [[`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d)]:
  - @mcut/timeline@0.1.0-alpha.8
  - @mcut/editor@0.1.0-alpha.8
  - @mcut/transcription@0.1.0-alpha.9

## 0.1.0-alpha.13

### Minor Changes

- [#160](https://github.com/mattppal/mcut/pull/160) [`d8d259b`](https://github.com/mattppal/mcut/commit/d8d259b1b390ff12eb0bacb5bfaa4449fe6ce3a2) Thanks [@mattppal](https://github.com/mattppal)! - Add `findRetakes` over word-timed transcripts and the `find_retakes` MCP tool, which returns candidate ranges that keep the last take, last to first. With `elementId` it also returns that clip's transcript in source time, ready to re-caption the clip after the cuts.

### Patch Changes

- Updated dependencies [[`d8d259b`](https://github.com/mattppal/mcut/commit/d8d259b1b390ff12eb0bacb5bfaa4449fe6ce3a2)]:
  - @mcut/transcription@0.1.0-alpha.8

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [[`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33), [`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33)]:
  - @mcut/timeline@0.1.0-alpha.7
  - @mcut/editor@0.1.0-alpha.7
  - @mcut/transcription@0.1.0-alpha.7

## 0.1.0-alpha.11

### Minor Changes

- [#154](https://github.com/mattppal/mcut/pull/154) [`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f) Thanks [@mattppal](https://github.com/mattppal)! - Add zoom regions, one punch-in object with in, hold, and out timing, a target, easing, and motion blur, on a clip or on one multicam source. Adds the `addZoomRegion`, `updateZoomRegion`, and `removeZoomRegion` commands, `getSlotView` and `getClipView`, compositor rendering with motion blur while a zoom moves, and the `list_zooms` and `edit_zooms` MCP tools.

### Patch Changes

- Updated dependencies [[`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f), [`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f)]:
  - @mcut/timeline@0.1.0-alpha.6
  - @mcut/editor@0.1.0-alpha.6
  - @mcut/transcription@0.1.0-alpha.6

## 0.1.0-alpha.10

### Minor Changes

- [#167](https://github.com/mattppal/mcut/pull/167) [`7b3a0c7`](https://github.com/mattppal/mcut/commit/7b3a0c71334f6bdc7981de5d1cda1323bbdcc25e) Thanks [@mattppal](https://github.com/mattppal)! - Add a `transact` tool that applies several tool calls as one undo step. If any call fails, the project and the undo stack stay as they were.

## 0.1.0-alpha.9

### Minor Changes

- [#166](https://github.com/mattppal/mcut/pull/166) [`814105a`](https://github.com/mattppal/mcut/commit/814105a74a3159f57d18865e885ef72681ae1032) Thanks [@mattppal](https://github.com/mattppal)! - Export runs as a job on the live bridge. `export_video` starts a render in Studio and returns a `jobId` at once, `get_export` reports the state, percent, and an ETA and long-polls with `waitMs` until the file is written, and `cancel_export` stops the render. The bridge writes the file itself, to `outputPath` or to `LiveBridgeOptions.exportDir` (default `~/Downloads`), so no download or save dialog opens. A second `export_video` while one runs fails with `export-busy`.

## 0.1.0-alpha.8

### Patch Changes

- [#170](https://github.com/mattppal/mcut/pull/170) [`7de9d8d`](https://github.com/mattppal/mcut/commit/7de9d8de87bf0446cb1ffa78a0b3f7885053bb15) Thanks [@mattppal](https://github.com/mattppal)! - The live bridge answers an unexpected HTTP handler error with 500 and refuses a WebSocket upgrade whose check throws, instead of crashing. `LiveBridgeOptions.onError` receives the error and defaults to stderr.

## 0.1.0-alpha.7

### Patch Changes

- [#164](https://github.com/mattppal/mcut/pull/164) [`1cc9630`](https://github.com/mattppal/mcut/commit/1cc963001005ace3da7b856cd300dc6b2794f0e3) Thanks [@mattppal](https://github.com/mattppal)! - The live bridge answers a request with a malformed URL or Host header with 400 instead of crashing.

## 0.1.0-alpha.6

### Minor Changes

- [#156](https://github.com/mattppal/mcut/pull/156) [`53b78d7`](https://github.com/mattppal/mcut/commit/53b78d7fdaaeed29df8d1654702d073eacf75e65) Thanks [@mattppal](https://github.com/mattppal)! - `run_action` and `list_actions` name `file.export-video` for export. `apply_captions` warns when its transcript matches no captions in the project, so invented transcripts are visible, and it now fails without touching existing captions when the transcript yields no captions. `applyAnimationPreset` points to `effects.fade-open-close` for a fade in and out as one undo step.

### Patch Changes

- Updated dependencies [[`53b78d7`](https://github.com/mattppal/mcut/commit/53b78d7fdaaeed29df8d1654702d073eacf75e65)]:
  - @mcut/timeline@0.1.0-alpha.5
  - @mcut/editor@0.1.0-alpha.5
  - @mcut/transcription@0.1.0-alpha.5

## 0.1.0-alpha.5

### Minor Changes

- [#155](https://github.com/mattppal/mcut/pull/155) [`b6f0765`](https://github.com/mattppal/mcut/commit/b6f07651f745e393b59e5db6dbc4e67f370939b3) Thanks [@mattppal](https://github.com/mattppal)! - The project summary lists each layout by role (picture-in-picture, full-frame, split) with every slot's pixel size and aspect. A `saveLayout` tool result shows each slot before and after with width and height change, and warns when a full-frame layout's only slot stops covering the frame.

### Patch Changes

- Updated dependencies [[`b6f0765`](https://github.com/mattppal/mcut/commit/b6f07651f745e393b59e5db6dbc4e67f370939b3)]:
  - @mcut/timeline@0.1.0-alpha.4
  - @mcut/editor@0.1.0-alpha.4
  - @mcut/transcription@0.1.0-alpha.4

## 0.1.0-alpha.4

### Minor Changes

- [#151](https://github.com/mattppal/mcut/pull/151) [`fa25629`](https://github.com/mattppal/mcut/commit/fa256296c4f284c58f289fc448564fc9c2fe2b88) Thanks [@mattppal](https://github.com/mattppal)! - Add a `mcp-server` bin so `npx -y @mcut/mcp-server` and `bunx @mcut/mcp-server project.mcut.json` start the stdio server. The bridge `/rpc` endpoint now requires the bridge token, and `mcut-bridge` reads it from `--token` or `MCUT_BRIDGE_TOKEN`.

## 0.1.0-alpha.3

### Patch Changes

- [#159](https://github.com/mattppal/mcut/pull/159) [`9b17ac7`](https://github.com/mattppal/mcut/commit/9b17ac71a1314a9197d350ae110783537b13243a) Thanks [@mattppal](https://github.com/mattppal)! - `applyAnimationPreset` takes an element-local `atMs`. In and emphasis presets start there, out presets end there, clamped to fit the clip. `withPlayheadDefaults` fills `atMs` from the playhead when the playhead is on the clip, and the MCP server and `applyCommands` use it.

- Updated dependencies [[`9b17ac7`](https://github.com/mattppal/mcut/commit/9b17ac71a1314a9197d350ae110783537b13243a)]:
  - @mcut/timeline@0.1.0-alpha.3
  - @mcut/editor@0.1.0-alpha.3
  - @mcut/transcription@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [[`e50b13b`](https://github.com/mattppal/mcut/commit/e50b13b76ecfb5dc8e75ffa3d01625b644c84a33)]:
  - @mcut/timeline@0.1.0-alpha.2
  - @mcut/editor@0.1.0-alpha.2
  - @mcut/transcription@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- [#19](https://github.com/mattppal/mcut/pull/19) [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad) Thanks [@mattppal](https://github.com/mattppal)! - Add audio activity analysis and expose it through MCP live browser sessions.

### Patch Changes

- [#99](https://github.com/mattppal/mcut/pull/99) [`74d241f`](https://github.com/mattppal/mcut/commit/74d241f337d475428d431c783d245d8f41bf9af2) Thanks [@mattppal](https://github.com/mattppal)! - The live bridge checks an exact `allowedOrigins` match before the `http:` and `https:` protocol test, so a desktop shell serving Studio from a custom scheme such as `app://studio` can connect. `GET /status` no longer returns `mcpUrl` or `openEditorUrl`, which carried the bridge token to any local process. Read the MCP URL from the `MCP_URL` line the bridge prints when it starts. `mcut bridge start` still prints the editor URL at startup.

- [#108](https://github.com/mattppal/mcut/pull/108) [`585981c`](https://github.com/mattppal/mcut/commit/585981c3b189f2301d7c98d990476de8efe2bb39) Thanks [@mattppal](https://github.com/mattppal)! - The `browser-not-connected` error from the live bridge names mcut Studio and `bun dev` instead of an editor URL with the bridge token.

- [#28](https://github.com/mattppal/mcut/pull/28) [`30d9168`](https://github.com/mattppal/mcut/commit/30d9168f944ce914d55e50107ae6bd6291386bd3) Thanks [@mattppal](https://github.com/mattppal)! - Wait briefly for the live editor WebSocket to reconnect before failing MCP bridge requests.

- [#30](https://github.com/mattppal/mcut/pull/30) [`db99ee6`](https://github.com/mattppal/mcut/commit/db99ee6828e372acf9c2c7b5247f21869603849f) Thanks [@mattppal](https://github.com/mattppal)! - Add a browser-safe `@mcut/mcp-server/contract` subpath exporting the MCP tool catalog (static tool definitions, profiles, `operatorToolName`, and tool-list composition helpers). The server now registers its tools from this contract, and the wire surface is pinned to it by a deep-equality test.

- [#93](https://github.com/mattppal/mcut/pull/93) [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46) Thanks [@mattppal](https://github.com/mattppal)! - Format sources with oxfmt.

- [#19](https://github.com/mattppal/mcut/pull/19) [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad) Thanks [@mattppal](https://github.com/mattppal)! - Require a live bridge token for `mcut-bridge start` browser WebSocket connections.

- [#63](https://github.com/mattppal/mcut/pull/63) [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0) Thanks [@mattppal](https://github.com/mattppal)! - Element, effect, transition, container, and renderer registries are now closed tables. `registerElement`, `registerEffect`, and the other register functions are removed. `engine.dispatch` takes `BuiltinCommand`.

- [#33](https://github.com/mattppal/mcut/pull/33) [`5f1cae7`](https://github.com/mattppal/mcut/commit/5f1cae7ccd6326366bc680e59a6f1226be620588) Thanks [@mattppal](https://github.com/mattppal)! - Rewrite package descriptions in plain prose.

- [#36](https://github.com/mattppal/mcut/pull/36) [`0fb2eb4`](https://github.com/mattppal/mcut/commit/0fb2eb4cca70c974b0d79802b047b3a2327e75c2) Thanks [@mattppal](https://github.com/mattppal)! - Give every package-level failure an owner instead of console output or an empty catch.

- [#66](https://github.com/mattppal/mcut/pull/66) [`3aefe7a`](https://github.com/mattppal/mcut/commit/3aefe7ad15084d9f6aa5a9a68f9edb63bffcbdde) Thanks [@mattppal](https://github.com/mattppal)! - The editor operator registry is now a closed table. `EditorOperatorRegistry`, `createEditorOperatorRegistry`, and `registerCoreOperators` are removed in favor of `operators`, `OperatorId`, `parseOperatorId`, `listOperators`, and `runOperator`. Captions, silence cuts, lint, and platform presets moved out of the CLI into `@mcut/editor` and `@mcut/transcription` as pure functions with zod input schemas, and the MCP server exposes them as the `apply_captions`, `apply_silence_cuts`, `lint_project`, and `list_presets` tools. `McutMcpTarget` gains `applyCommands`, and the `operators` option on `createMcutMcpServer` is gone.

- [#39](https://github.com/mattppal/mcut/pull/39) [`532fa97`](https://github.com/mattppal/mcut/commit/532fa97c63721f29e45e1a07e1948428ff9a7d80) Thanks [@mattppal](https://github.com/mattppal)! - Tell users to run bun run dev and use the printed MCP URL when no editor tab is connected.

- [#75](https://github.com/mattppal/mcut/pull/75) [`dbf2f16`](https://github.com/mattppal/mcut/commit/dbf2f16e00c962c65159d4ab418accb35748e12a) Thanks [@mattppal](https://github.com/mattppal)! - Remove comments from the React bindings and the MCP server. Constraints stay as names and types.

- [#50](https://github.com/mattppal/mcut/pull/50) [`135bdd0`](https://github.com/mattppal/mcut/commit/135bdd05b0954489c9fffcb64fc9517cfe4ffeae) Thanks [@mattppal](https://github.com/mattppal)! - Static MCP tool arguments are parsed with zod before the handler runs and a bad argument is reported by field name, and `@mcut/transcription` exports `transcriptResultSchema` as the source of its `TranscriptResult` type.

- Updated dependencies [[`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b), [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc), [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`187afb7`](https://github.com/mattppal/mcut/commit/187afb714bc18d72bed179cd7a46be83a3aa13b6), [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78), [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a), [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1), [`3aefe7a`](https://github.com/mattppal/mcut/commit/3aefe7ad15084d9f6aa5a9a68f9edb63bffcbdde), [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7), [`804ad84`](https://github.com/mattppal/mcut/commit/804ad84e6a46426b8cef655f97db291a2749e42d), [`135bdd0`](https://github.com/mattppal/mcut/commit/135bdd05b0954489c9fffcb64fc9517cfe4ffeae)]:
  - @mcut/timeline@0.1.0-alpha.1
  - @mcut/editor@0.1.0-alpha.1
  - @mcut/transcription@0.1.0-alpha.1
