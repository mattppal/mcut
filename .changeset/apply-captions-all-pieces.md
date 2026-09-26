---
"@mcut/mcp-server": minor
"@mcut/timeline": minor
---

`apply_captions` with `elementId` now captions every piece on that clip's track that plays the same audio, so after retake or silence cuts one call with the full source-time transcript re-captions the whole cut. It replaces only the old captions over pieces the transcript has words for, plus captions over no clip, in one undo step. `scope: "clip"` keeps the old single-clip behavior. `applyCaptions` takes `replaceIds` to remove specific caption elements without a ripple.

`find_retakes` keeps zero-length words in the transcript it returns, so passing that transcript back to `apply_captions` captions every word.
