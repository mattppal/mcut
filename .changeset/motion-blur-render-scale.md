---
'@mcut/compositor': minor
---

`RenderFrameOptions.renderScale` renders motion blur samples at that fraction of the project resolution and composites them over the whole frame. It defaults to 1, so export and every other caller keep full-resolution samples.
