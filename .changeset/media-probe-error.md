---
"@mcut/media": patch
---

`probeMedia` and `createAssetFromFile` reject with a typed `MediaProbeError` (`code` is `unreadable` or `no-tracks`, the parser failure is kept on `cause`) instead of leaking whatever the container parser threw.
