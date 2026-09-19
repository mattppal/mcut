---
"@mcut/media": patch
---

`probeMedia` reports the duration stored in the container when no packet can be read. A Matroska or WebM file whose only cluster is cut short now probes with its Segment Info duration instead of `durationMs` 0.
