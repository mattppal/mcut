---
"@mcut/compositor": minor
---

`createElementContext` takes the render options in place of the frame source, an optional view time, and an optional viewport. The render context gains `acquireScratch`, an off screen 2D surface that is reused across frames. A renderer composes into it and draws it straight away. It also gains `viewport`, the part of the frame the target shows, or `null` inside a transition and by default. Motion blur passes draw from the same scratch cache, and `createScratchContext` in the render options still overrides it.
