---
"@mcut/media": minor
---

`createAssetFromFile(file)` is renamed to `createAsset(origin, prober?)`. The origin is a `MediaOrigin`, today `{ kind: 'blob', blob, name }`, and the prober is a `MediaProber`, an object with an `id` and a `probe(origin, signal?)` method that returns a `MediaProbe`. The default prober is the new `mediabunnyProber` export, which wraps `probeMedia` with unchanged behavior, so `createAsset({ kind: 'blob', blob: file, name: file.name })` produces the same `AssetRef` the old call did. The media fuzzer now runs its invariants through a `MediaProber`, so a second engine can reuse the same invariant set.
