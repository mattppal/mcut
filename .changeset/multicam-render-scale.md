---
"@mcut/compositor": minor
---

`RenderBackend` now states its `renderScale`, the number of target pixels one project unit covers. `Canvas2DBackend` reads it from the context's transform when constructed, and `WebGPUBackend` from its canvas width. A multicam composes at that scale. A still rendered at 2x or 4x keeps the detail of sources larger than the project, the way a video clip does. A preview or a motion blur pass drawn below full size composes only the pixels it shows. A custom backend must add the property.
