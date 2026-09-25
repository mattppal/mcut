---
'@mcut/react': patch
---

`PlayerCanvas` passes its preview scale to the compositor as `renderScale`, so motion blur during playback renders its samples at preview resolution instead of project resolution.
