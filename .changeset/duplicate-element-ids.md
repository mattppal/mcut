---
"@mcut/timeline": patch
---

`splitElement`, `createMulticam`, `detachAudio`, and `applyCaptions` now reject a caller-supplied element id that already exists with `CommandError` code `duplicate-element`, matching `addElement`.
