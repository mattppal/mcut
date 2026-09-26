---
"@mcut/compositor": minor
---

`createElementContext` takes the render options in place of the frame source. The render context gains `acquireScratch`, an off screen 2D surface that is reused across frames. A renderer composes into it and draws it straight away. Motion blur passes draw from the same scratch cache, and `createScratchContext` in the render options still overrides it.
