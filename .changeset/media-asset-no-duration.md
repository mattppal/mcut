---
"@mcut/media": patch
---

`createAssetFromFile` rejects a file whose probe reports `durationMs` 0 with a `MediaProbeError` (`code` `no-duration`) instead of returning an `AssetRef` that `addAsset` then refuses with a payload `CommandError`. A half-written WebM now fails the import with a media error, the same way an unreadable file does.
