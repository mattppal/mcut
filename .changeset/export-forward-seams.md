---
"@mcut/media": patch
---

A clip whose audio starts partway into its source, such as the second clip of a split, a clip trimmed at its start, or the take after a removed retake, no longer clicks or drops out at its first frame in the export. A forward or time-stretched decode now begins up to 8192 frames before the clip's first frame and drops that lead-in, as reversed decodes already did, so an AAC, MP3, or Opus decoder is warm by that frame. A clip that starts at the beginning of its source exports the same audio as before.
