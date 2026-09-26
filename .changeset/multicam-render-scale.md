---
"@mcut/compositor": minor
---

`RenderBackend` now states its `renderScale`, the number of target pixels one project unit covers. `Canvas2DBackend` reads it from the context's transform when constructed, and `WebGPUBackend` from its canvas width. A custom backend must add the property. A multicam composes at the density it lands on the target, its transform scale at the frame times `renderScale`. A zoom region without `source` scales the sources as they compose. A multicam magnified by its transform, by a keyframed punch-in, or by a zoom region without `source` stays as sharp as a video clip at the same scale, and a still rendered at 2x or 4x keeps the detail of sources larger than the project. A preview or a motion blur pass drawn below full size composes only the pixels it shows. A multicam composes only the part of its crop the target shows, so magnifying it past the canvas composes about as many pixels as the canvas has. Each side of the compose stops at 8192 pixels.
