---
"@mcut/timeline": patch
---

`applyThumbnail` now puts each text layer of a thumbnail template on its own locked "Thumbnail" track, so the layers no longer overlap on one track and every layer stays editable with `updateElement` and `moveElement`. `findThumbnailTrack` is replaced by `findThumbnailTracks`.
