---
"@mcut/media": patch
---

Preview feeds and export audio play a multicam through the same media clip path as a video clip. A multicam plays at its own speed, a reversed multicam is silent in preview like a reversed video, and a multicam on a hidden and muted track is skipped. Audio-only sources feed as audio. Export audio honors the source offset, trim, and reverse of every media clip.
