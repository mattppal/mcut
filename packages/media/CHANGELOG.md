# @mcut/media

## 0.1.0-alpha.30

### Patch Changes

- [#209](https://github.com/mattppal/mcut/pull/209) [`a7d54c8`](https://github.com/mattppal/mcut/commit/a7d54c87e636ef5c431c07a7f051887dc33f0a17) Thanks [@mattppal](https://github.com/mattppal)! - A clip whose audio starts partway into its source, such as the second clip of a split, a clip trimmed at its start, or the take after a removed retake, no longer clicks or drops out at its first frame in the export. A forward or time-stretched decode now begins up to 8192 frames before the clip's first frame and drops that lead-in, as reversed decodes already did, so an AAC, MP3, or Opus decoder is warm by that frame. A clip that starts at the beginning of its source exports the same audio as before.

## 0.1.0-alpha.29

### Patch Changes

- Updated dependencies [[`1fab6ca`](https://github.com/mattppal/mcut/commit/1fab6cada1e1310f196b7f05e49cf15145cad849)]:
  - @mcut/timeline@0.1.0-alpha.19
  - @mcut/compositor@0.1.0-alpha.20

## 0.1.0-alpha.28

### Patch Changes

- Updated dependencies [[`ec1f719`](https://github.com/mattppal/mcut/commit/ec1f719b9a09f82dd95d548ec4a44f989895e8de)]:
  - @mcut/timeline@0.1.0-alpha.18
  - @mcut/compositor@0.1.0-alpha.19

## 0.1.0-alpha.27

### Patch Changes

- Updated dependencies [[`74b5c22`](https://github.com/mattppal/mcut/commit/74b5c22a2c48244113e77ca5f3e03a1c23b80774)]:
  - @mcut/timeline@0.1.0-alpha.17
  - @mcut/compositor@0.1.0-alpha.18

## 0.1.0-alpha.26

### Patch Changes

- [#193](https://github.com/mattppal/mcut/pull/193) [`2290576`](https://github.com/mattppal/mcut/commit/2290576af0c2442076a14a5df44b838eaeb486ad) Thanks [@mattppal](https://github.com/mattppal)! - A reversed clip whose source is longer than the one-buffer mix can hold now exports reversed audio in bounded chunks, instead of a finished file with that clip silent. Each reversed decode starts 8192 frames early and drops that lead-in, so a chunk boundary or a join between reversed clips is not a click from a cold AAC, MP3, or Opus decoder. A reversed clip that is also time-stretched past the same limit fails the export, and the error names the clip.

## 0.1.0-alpha.25

### Patch Changes

- Updated dependencies [[`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1), [`5620a72`](https://github.com/mattppal/mcut/commit/5620a723c6dd3e6ed05c412dae468b9b21f2eae1)]:
  - @mcut/timeline@0.1.0-alpha.16
  - @mcut/compositor@0.1.0-alpha.17

## 0.1.0-alpha.24

### Patch Changes

- Updated dependencies [[`47f2eab`](https://github.com/mattppal/mcut/commit/47f2eab353bd22e9416c2d39c398f0169bc97b6b)]:
  - @mcut/compositor@0.1.0-alpha.16

## 0.1.0-alpha.23

### Patch Changes

- Updated dependencies [[`d9c79e8`](https://github.com/mattppal/mcut/commit/d9c79e82e236119e64192b02ece2529e1cac6a38)]:
  - @mcut/timeline@0.1.0-alpha.15
  - @mcut/compositor@0.1.0-alpha.15

## 0.1.0-alpha.22

### Patch Changes

- Updated dependencies [[`8e23a05`](https://github.com/mattppal/mcut/commit/8e23a054f987d7cdb3deef7866517164c63c351e)]:
  - @mcut/timeline@0.1.0-alpha.14
  - @mcut/compositor@0.1.0-alpha.14

## 0.1.0-alpha.21

### Patch Changes

- Updated dependencies [[`fa6f581`](https://github.com/mattppal/mcut/commit/fa6f581da9ce078b05916c46bfa5159e61b341a5)]:
  - @mcut/timeline@0.1.0-alpha.13
  - @mcut/compositor@0.1.0-alpha.13

## 0.1.0-alpha.20

### Patch Changes

- [#182](https://github.com/mattppal/mcut/pull/182) [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b) Thanks [@mattppal](https://github.com/mattppal)! - Preview feeds and export audio play a multicam through the same media clip path as a video clip. A multicam plays at its own speed, a reversed multicam is silent in preview like a reversed video, and a multicam on a hidden and muted track is skipped. Audio-only sources feed as audio. Export audio honors the source offset, trim, and reverse of every media clip.

- Updated dependencies [[`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b), [`4f45456`](https://github.com/mattppal/mcut/commit/4f45456d76e16003afc6765c7c51174c46f1001b)]:
  - @mcut/timeline@0.1.0-alpha.12
  - @mcut/compositor@0.1.0-alpha.12

## 0.1.0-alpha.19

### Patch Changes

- Updated dependencies [[`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78), [`9b91a7b`](https://github.com/mattppal/mcut/commit/9b91a7b4e74b9eae01a9f46e864014e88284cd78)]:
  - @mcut/timeline@0.1.0-alpha.11
  - @mcut/compositor@0.1.0-alpha.11

## 0.1.0-alpha.18

### Minor Changes

- [#195](https://github.com/mattppal/mcut/pull/195) [`c5aed4a`](https://github.com/mattppal/mcut/commit/c5aed4a4615a3fd5dcb1d76c385cd28ea3574b40) Thanks [@mattppal](https://github.com/mattppal)! - Find where the picture changes with `findSceneChanges`, and render a labelled thumbnail grid with `renderContactSheet`. Both read one video clip or one multicam source over a timeline range. Agents get them as the `find_scene_changes` and `get_contact_sheet` MCP tools on the live Studio bridge.

  `find_scene_changes` compares 64 by 36 luma frames every `stepMs`, reports a change when the changed fraction of the picture passes the `sensitivity` threshold, and refines each change to the exact frame. It returns the changes and the stable segments between them.

  `McutMcpTarget.findSceneChanges` and `getContactSheet` are optional. On a target without them, the tools fail with `find_scene_changes requires the live bridge connected to Studio.` and the same for `get_contact_sheet`.

## 0.1.0-alpha.17

### Patch Changes

- [#190](https://github.com/mattppal/mcut/pull/190) [`0792372`](https://github.com/mattppal/mcut/commit/0792372e344836d0a7ae62b87039eec934bfccda) Thanks [@mattppal](https://github.com/mattppal)! - Export, the decoded preview for video without native playback, thumbnails, and filmstrips copy each decoded video frame to RGBA before they draw it, in browsers whose `VideoFrame.copyTo` accepts a `format`. A long export or MKV playback no longer leaves hundreds of megabytes of shared memory and about 80 open file descriptors in the Studio renderer. Export also reuses one RGBA buffer across frames, which made a 6 minute 1080p export about 12% faster in the desktop app.

## 0.1.0-alpha.16

### Patch Changes

- [#192](https://github.com/mattppal/mcut/pull/192) [`5f65e81`](https://github.com/mattppal/mcut/commit/5f65e81bc45b09fe8b24b53a384aee1922717263) Thanks [@mattppal](https://github.com/mattppal)! - A decoded-preview clip (MKV, WebM) placed in the first 3 seconds after load starts decoding at once instead of waiting for a retry that a paused preview never triggered, and a failed decode start moves `frameVersion` once its retry window passes, so a paused preview no longer stays black.

## 0.1.0-alpha.15

### Minor Changes

- [#168](https://github.com/mattppal/mcut/pull/168) [`670b34b`](https://github.com/mattppal/mcut/commit/670b34b4279a1e3f344674cf8aa2673fdd86c455) Thanks [@mattppal](https://github.com/mattppal)! - Render one project frame to a PNG with `renderProjectStill`, and expose it to agents as the `get_frame` MCP tool on the live Studio bridge.

  `McutMcpTarget.getFrame` is optional, like the other live-only members, so a custom target without it still compiles. `get_frame` on such a target fails with `get_frame requires the live bridge connected to Studio.`

### Patch Changes

- [#168](https://github.com/mattppal/mcut/pull/168) [`670b34b`](https://github.com/mattppal/mcut/commit/670b34b4279a1e3f344674cf8aa2673fdd86c455) Thanks [@mattppal](https://github.com/mattppal)! - `renderProjectStill` renders the last frame for a `timeMs` at the project end. It returned a black frame with no visible elements.

- [#168](https://github.com/mattppal/mcut/pull/168) [`670b34b`](https://github.com/mattppal/mcut/commit/670b34b4279a1e3f344674cf8aa2673fdd86c455) Thanks [@mattppal](https://github.com/mattppal)! - `renderProjectStill` draws nothing for a video at times before the video's first timestamp, as export and the Studio preview do. It threw that the asset had no video frame.

- [#168](https://github.com/mattppal/mcut/pull/168) [`670b34b`](https://github.com/mattppal/mcut/commit/670b34b4279a1e3f344674cf8aa2673fdd86c455) Thanks [@mattppal](https://github.com/mattppal)! - `renderProjectStill` copies each decoded video frame to RGBA before it draws it, in browsers whose `VideoFrame.copyTo` accepts a `format`. Repeated `get_frame` calls no longer grow the Studio renderer's shared memory and open file descriptors.

## 0.1.0-alpha.14

### Patch Changes

- [#171](https://github.com/mattppal/mcut/pull/171) [`fed2a9e`](https://github.com/mattppal/mcut/commit/fed2a9e931caf36072346453da30835824944580) Thanks [@mattppal](https://github.com/mattppal)! - Long exports no longer spend minutes mixing audio.

## 0.1.0-alpha.13

### Patch Changes

- [#187](https://github.com/mattppal/mcut/pull/187) [`2ade70e`](https://github.com/mattppal/mcut/commit/2ade70e1316317492c4be49c2b19ea7f9f989008) Thanks [@mattppal](https://github.com/mattppal)! - A paused `PlayerCanvas` paints once and then skips the render until the project, playhead, size, selection, fonts, or a media frame changes, so a motion-blurred frame no longer redraws on every animation frame. `PreviewMediaPool` exposes `frameVersion`, which moves when a seek starts or lands, a video loads, a decoded frame arrives, or an image loads. `extractAudioToWav` takes an `AbortSignal` and cancels the conversion when it fires.

## 0.1.0-alpha.12

### Minor Changes

- [#180](https://github.com/mattppal/mcut/pull/180) [`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928) Thanks [@mattppal](https://github.com/mattppal)! - `createLocalFaceDetector()` detects faces in a video on the user's device. `detect(src)` samples the video `sampleRateHz` times per second, 5 by default, and runs the YuNet 2023mar model with `onnxruntime-web` in a module worker. It resolves to one `FaceSample` per sample. Each sample's `box` is the largest face in fractions of the source frame, or `null` when no face scores at least 0.6. The model downloads once from Hugging Face into Cache Storage. Pass `ortWasmPaths` to serve the onnxruntime wasm from your own origin instead of jsDelivr. Aborting the `signal` terminates the worker, and the next call starts a fresh one.

### Patch Changes

- Updated dependencies [[`de6ad86`](https://github.com/mattppal/mcut/commit/de6ad86850e763a48f50e4800329e66ba5551928)]:
  - @mcut/timeline@0.1.0-alpha.10
  - @mcut/compositor@0.1.0-alpha.10

## 0.1.0-alpha.11

### Patch Changes

- Updated dependencies [[`9f1ebce`](https://github.com/mattppal/mcut/commit/9f1ebce07c0d449e6818951fabb61668b27852e2)]:
  - @mcut/timeline@0.1.0-alpha.9
  - @mcut/compositor@0.1.0-alpha.9

## 0.1.0-alpha.10

### Minor Changes

- [#161](https://github.com/mattppal/mcut/pull/161) [`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d) Thanks [@mattppal](https://github.com/mattppal)! - Video, audio, and multicam clips can store an optional voice cleanup mix. The Clean up voice operator toggles that mix on the current selection in one undo step. Export and preview accept a replacement audio URL per clip so a cleaned stem can stand in for the clip's original audio.

### Patch Changes

- Updated dependencies [[`2efc9c8`](https://github.com/mattppal/mcut/commit/2efc9c80954559389c540502b63c821a9e1fe97d)]:
  - @mcut/timeline@0.1.0-alpha.8
  - @mcut/compositor@0.1.0-alpha.8

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies [[`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33), [`ebca791`](https://github.com/mattppal/mcut/commit/ebca791dc3e228b0d825dce42e4e8599b4ad8c33)]:
  - @mcut/timeline@0.1.0-alpha.7
  - @mcut/compositor@0.1.0-alpha.7

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies [[`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f), [`a9c52b1`](https://github.com/mattppal/mcut/commit/a9c52b10f4e445b6e34bc4b3dc8424b4bda8d99f)]:
  - @mcut/timeline@0.1.0-alpha.6
  - @mcut/compositor@0.1.0-alpha.6

## 0.1.0-alpha.7

### Patch Changes

- [#176](https://github.com/mattppal/mcut/pull/176) [`bb7411b`](https://github.com/mattppal/mcut/commit/bb7411b8ae17dfe3e8c373fb67719abe5060505f) Thanks [@mattppal](https://github.com/mattppal)! - Exported audio no longer lags the video by the AAC encoder's priming samples. The export measures the audio encoder's delay once per container, codec, and sample rate, and starts the audio track that much earlier, so MP4 gets an edit list that trims the priming. Mediabunny is now 1.60.0, which writes negative timestamps.

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies [[`53b78d7`](https://github.com/mattppal/mcut/commit/53b78d7fdaaeed29df8d1654702d073eacf75e65)]:
  - @mcut/timeline@0.1.0-alpha.5
  - @mcut/compositor@0.1.0-alpha.5

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies [[`b6f0765`](https://github.com/mattppal/mcut/commit/b6f07651f745e393b59e5db6dbc4e67f370939b3)]:
  - @mcut/timeline@0.1.0-alpha.4
  - @mcut/compositor@0.1.0-alpha.4

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies [[`9b17ac7`](https://github.com/mattppal/mcut/commit/9b17ac71a1314a9197d350ae110783537b13243a)]:
  - @mcut/timeline@0.1.0-alpha.3
  - @mcut/compositor@0.1.0-alpha.3

## 0.1.0-alpha.3

### Patch Changes

- [#146](https://github.com/mattppal/mcut/pull/146) [`4235b69`](https://github.com/mattppal/mcut/commit/4235b69965989581aa1674049144c9b633704856) Thanks [@mattppal](https://github.com/mattppal)! - Load Mediabunny on first use instead of at import. `inputFor` and `ContainerFormat.createOutputFormat` are async now, and `exportProject` and `getExportSupport` load the export pipeline on demand, so an app that imports `@mcut/media` for the preview pool no longer ships the demuxers, muxers, and export code in its startup bundle. `preloadMediabunny` warms the download after first paint.

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [[`e50b13b`](https://github.com/mattppal/mcut/commit/e50b13b76ecfb5dc8e75ffa3d01625b644c84a33)]:
  - @mcut/timeline@0.1.0-alpha.2
  - @mcut/compositor@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- [#19](https://github.com/mattppal/mcut/pull/19) [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad) Thanks [@mattppal](https://github.com/mattppal)! - Add audio activity analysis and expose it through MCP live browser sessions.

- [#103](https://github.com/mattppal/mcut/pull/103) [`3af366e`](https://github.com/mattppal/mcut/commit/3af366ee9086d2c2cfbd87d6a836ae73a6123aac) Thanks [@mattppal](https://github.com/mattppal)! - `createAssetFromFile(file)` is renamed to `createAsset(origin, prober?)`. The origin is a `MediaOrigin`, today `{ kind: 'blob', blob, name }`, and the prober is a `MediaProber`, an object with an `id` and a `probe(origin, signal?)` method that returns a `MediaProbe`. The default prober is the new `mediabunnyProber` export, which wraps `probeMedia` with unchanged behavior, so `createAsset({ kind: 'blob', blob: file, name: file.name })` produces the same `AssetRef` the old call did. The media fuzzer now runs its invariants through a `MediaProber`, so a second engine can reuse the same invariant set.

### Patch Changes

- [#89](https://github.com/mattppal/mcut/pull/89) [`a356c6e`](https://github.com/mattppal/mcut/commit/a356c6e9d9fc3adc8fefc9f5ce1a1e905fa4e8b2) Thanks [@mattppal](https://github.com/mattppal)! - `createAssetFromFile` rejects a file whose probe reports `durationMs` 0 with a `MediaProbeError` (`code` `no-duration`) instead of returning an `AssetRef` that `addAsset` then refuses with a payload `CommandError`. A half-written WebM now fails the import with a media error, the same way an unreadable file does.

- [#80](https://github.com/mattppal/mcut/pull/80) [`2ca7872`](https://github.com/mattppal/mcut/commit/2ca787282001ff71ba97f78a9c565c8762673e93) Thanks [@mattppal](https://github.com/mattppal)! - `probeMedia` and `createAssetFromFile` reject with a typed `MediaProbeError` (`code` is `unreadable` or `no-tracks`, the parser failure is kept on `cause`) instead of leaking whatever the container parser threw.

- [#88](https://github.com/mattppal/mcut/pull/88) [`ca38e50`](https://github.com/mattppal/mcut/commit/ca38e50bd3a0bf82f18f7b0ce242e8098d54e861) Thanks [@mattppal](https://github.com/mattppal)! - `probeMedia` reports the duration stored in the container when no packet can be read. A Matroska or WebM file whose only cluster is cut short now probes with its Segment Info duration instead of `durationMs` 0.

- [#86](https://github.com/mattppal/mcut/pull/86) [`8dda500`](https://github.com/mattppal/mcut/commit/8dda500d48128b67842df7f21d9ea7d6b177e709) Thanks [@mattppal](https://github.com/mattppal)! - `probeMedia` settles on a FLAC file that ends after its metadata blocks instead of never resolving. A track that yields no packet is left out of the duration computation, which is where mediabunny's FLAC demuxer spun forever.

- [#28](https://github.com/mattppal/mcut/pull/28) [`30d9168`](https://github.com/mattppal/mcut/commit/30d9168f944ce914d55e50107ae6bd6291386bd3) Thanks [@mattppal](https://github.com/mattppal)! - Return `null` instead of rejecting when thumbnail or filmstrip decoding fails for unreadable video sources.

- [#15](https://github.com/mattppal/mcut/pull/15) [`6aa83dc`](https://github.com/mattppal/mcut/commit/6aa83dc4c2437f4f12984de2659fb494eea0eb19) Thanks [@mattppal](https://github.com/mattppal)! - Fall back to browser-native video frame capture for thumbnails and filmstrips when Mediabunny decoding fails.

- [#93](https://github.com/mattppal/mcut/pull/93) [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46) Thanks [@mattppal](https://github.com/mattppal)! - Format sources with oxfmt.

- [#29](https://github.com/mattppal/mcut/pull/29) [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78) Thanks [@mattppal](https://github.com/mattppal)! - Add grouped timeline elements and editable sequential video collage primitives with grouped canvas transforms, plus stable export frame snapshots for repeated collage draws.

- [#63](https://github.com/mattppal/mcut/pull/63) [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0) Thanks [@mattppal](https://github.com/mattppal)! - Element, effect, transition, container, and renderer registries are now closed tables. `registerElement`, `registerEffect`, and the other register functions are removed. `engine.dispatch` takes `BuiltinCommand`.

- [#67](https://github.com/mattppal/mcut/pull/67) [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1) Thanks [@mattppal](https://github.com/mattppal)! - Replace internal non-null assertions and type casts with constructed shapes, typed lookups, and checked accessors; no behavior change.

- [#36](https://github.com/mattppal/mcut/pull/36) [`0fb2eb4`](https://github.com/mattppal/mcut/commit/0fb2eb4cca70c974b0d79802b047b3a2327e75c2) Thanks [@mattppal](https://github.com/mattppal)! - Give every package-level failure an owner instead of console output or an empty catch.

- [#79](https://github.com/mattppal/mcut/pull/79) [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7) Thanks [@mattppal](https://github.com/mattppal)! - Remove internal comments and keep the constraints they described as names, types, and tests; no behavior change.

- Updated dependencies [[`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b), [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc), [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78), [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a), [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1), [`5f1cae7`](https://github.com/mattppal/mcut/commit/5f1cae7ccd6326366bc680e59a6f1226be620588), [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7), [`b0d4b0e`](https://github.com/mattppal/mcut/commit/b0d4b0eaf704ac2e127213f84d4c5afd5b42c9f4)]:
  - @mcut/timeline@0.1.0-alpha.1
  - @mcut/compositor@0.1.0-alpha.1
