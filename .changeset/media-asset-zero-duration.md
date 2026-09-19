---
"@mcut/media": patch
---

`createAssetFromFile` rejects a file whose tracks probe to a duration of 0 ms with a `MediaProbeError` whose `code` is `zero-duration`, instead of returning an `AssetRef` that `addAsset` then rejects with a payload error.
