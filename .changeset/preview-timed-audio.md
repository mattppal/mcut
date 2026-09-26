---
"@mcut/media": minor
"@mcut/react": minor
---

Preview plays audio from the same timed decode and segment mixer as export, on one `AudioContext`, so preview and export are heard at the same source time for every container. `PlayerCanvas` advances playback by that audio clock. Breaking changes: `PreviewMediaPool` now shows picture only and its sound lives on `pool.audio`, a `PreviewAudio`. `setAudioSources` and `getAudioSources` moved to `pool.audio`. `getActiveMediaItems` takes no `audioSources` and returns only video feeds, `ActiveMediaItem` drops `kind`, `volume`, and `audioSrc`, and `PreviewSyncOptions` drops `masterVolume` and `muted`.
