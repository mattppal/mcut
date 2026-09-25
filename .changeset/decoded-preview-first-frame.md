---
'@mcut/media': patch
---

A decoded-preview clip (MKV, WebM) placed in the first 3 seconds after load starts decoding at once instead of waiting for a retry that a paused preview never triggered, and a failed decode start moves `frameVersion` once its retry window passes, so a paused preview no longer stays black.
