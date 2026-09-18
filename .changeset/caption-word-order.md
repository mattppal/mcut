---
"@mcut/timeline": patch
---

`captionWordSchema` now requires `endMs >= startMs`, so an inverted word is rejected at `addElement` and `applyCaptions` instead of producing a negative `endMs` after a trim that `parseProject` rejects.
