---
"@mcut/media": patch
---

`probeMedia` settles on a FLAC file that ends after its metadata blocks instead of never resolving. A track that yields no packet is left out of the duration computation, which is where mediabunny's FLAC demuxer spun forever.
