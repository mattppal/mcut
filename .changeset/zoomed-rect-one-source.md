---
"@mcut/timeline": patch
"@mcut/compositor": patch
---

`getZoomedRect` maps a rect through a zoom view. The compositor crops a whole-composite zoom through it and `flattenMulticam` bakes clip boxes through it, so the two cannot drift.
