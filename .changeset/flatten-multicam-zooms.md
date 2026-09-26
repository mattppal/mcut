---
'@mcut/timeline': patch
---

`flattenMulticam` now keeps zoom regions. A zoom on a source moves onto each clip cut from that source, in that clip's time, and zooms on other sources drop. A zoom that spans an angle cut is copied onto the clip after the cut with `-r` appended to its id.
