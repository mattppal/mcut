---
'@mcut/react': patch
'@mcut/media': patch
---

A paused `PlayerCanvas` paints once and then skips the render until the project, playhead, size, selection, fonts, or a media frame changes, so a motion-blurred frame no longer redraws on every animation frame. `PreviewMediaPool` exposes `frameVersion`, which moves when a seek starts or lands, a video loads, a decoded frame arrives, or an image loads. `extractAudioToWav` takes an `AbortSignal` and cancels the conversion when it fires.
