---
'@mcut/timeline': patch
---

`updateElement` and `addElement` now reject a `zooms` array whose zooms overlap on one target, the rule `addZoomRegion` and `updateZoomRegion` already enforce. A `transact` that writes `zooms` through `updateElement` gets the same check.
