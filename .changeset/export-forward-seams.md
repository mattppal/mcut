---
"@mcut/media": patch
---

A clip whose audio starts partway into its source, such as either side of a cut, a trim, or a retake removal, no longer clicks or drops out at its first frame in the export. Every forward and time-stretched decode now starts 8192 frames early and drops that lead-in, as reversed decodes already did, so an AAC, MP3, or Opus decoder is warm by the cut. A clip that starts at the beginning of its source exports the same audio as before.
