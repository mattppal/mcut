---
"@mcut/timeline": minor
"@mcut/compositor": patch
---

`getZoomWindow(view, visible)` returns the part of the content a zoom view shows, as a normalized rect anchored at the view's focus. `getZoomedRect` maps a rect through that window, and the compositor draws a clip's zoom and a slot's zoom from it, so the renderer and `flattenMulticam` read one zoom formula.
