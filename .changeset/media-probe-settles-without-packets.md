---
"@mcut/media": patch
---

`probeMedia` settles on a FLAC file that ends after its metadata blocks. It now computes the duration only over tracks that yield a first packet, so mediabunny's FLAC demuxer no longer spins forever looking for a frame that is not there, and such a file probes with `durationMs` 0 instead of hanging the import.
