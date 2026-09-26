---
"@mcut/media": minor
"@mcut/react": minor
---

Preview plays audio from the same timed decode and segment mixer as export, on one `AudioContext`, so preview and export are heard at the same source time for every container. `PlayerCanvas` advances playback by that audio clock. A clip at a constant speed plays from one continuous decode and one time stretcher, so stretched and reversed clips have no seams, and a clip played from its start matches export's decoded and stretched samples. A play that starts inside a clip can sit from export by the container's timestamp rounding, about a millisecond in WebM. A clip on a speed curve plays in crossfaded half-second windows. A playback rate change crossfades into the new rate instead of cutting to silence. `PreviewAudio` is exported as a type. Breaking changes: `PreviewMediaPool` now shows picture only and its sound lives on `pool.audio`, a `PreviewAudio`. `setAudioSources` and `getAudioSources` moved to `pool.audio`. `getActiveMediaItems` takes no `audioSources` and returns only video feeds, `ActiveMediaItem` drops `kind`, `volume`, and `audioSrc`, and `PreviewSyncOptions` drops `masterVolume` and `muted`.
