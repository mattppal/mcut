---
"@mcut/media": patch
---

`renderProjectStill` draws nothing for a video at times before the video's first timestamp, as export and the Studio preview do. It threw that the asset had no video frame.
