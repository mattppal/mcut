# @mcut/media

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
