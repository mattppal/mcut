---
"@mcut/media": patch
---

Exported audio no longer lags the video by the AAC encoder's priming samples. The export measures the audio encoder's delay once per container, codec, and sample rate, and starts the audio track that much earlier, so MP4 gets an edit list that trims the priming. Mediabunny is now 1.60.0, which writes negative timestamps.
