---
"@mcut/timeline": minor
"@mcut/compositor": patch
---

A multicam slot zoom frames inside the slot's crop. The slot's cover or contain fit is measured over its crop, the zoom scales that fit, and the target lands inside the crop window, so a zoom never shows source the crop cuts away. Outside a zoom, `getSlotView` returns the center at scale 1, because the slot's crop now sets its framing. Zoom `focus` and `rect` are 0 to 1 across the cropped frame of the clip or slot. `VisibleFraction`, the type of the `visible` argument of `getSlotView`, is exported.
