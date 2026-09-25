---
'@mcut/editor': minor
'@mcut/timeline': minor
---

Add `planZoomRegionDrag` and `planZoomAtPlayhead` to `@mcut/editor`, the headless planners behind the Studio zoom lane. A drag moves the whole zoom, its start, the inner edge of either ramp, or its end. Every drag keeps valid ramp and hold lengths, and a move or outer edge drag also stops at the element edges and at neighboring zooms on its target. `planZoomAtPlayhead` starts a preset or an explicit zoom shape at the playhead and picks the `screen` source on a multicam. `@mcut/timeline` now exports `isZoomable`, `ZoomableElement`, and `zoomRegionEndMs`.
