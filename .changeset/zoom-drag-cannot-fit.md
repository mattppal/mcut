---
'@mcut/editor': patch
---

`planZoomRegionDrag` returns the zoom unchanged when no drag of the requested kind can fit it in its piece, such as a zoom left longer than a split piece. It used to return a timing with a negative `atMs` or one `updateZoomRegion` rejects.
