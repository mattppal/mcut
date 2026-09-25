---
"@mcut/timeline": patch
---

`flattenMulticam` copies each source's `reframe` track onto every video clip cut from that source, so a flattened camera keeps following the person. The track is keyed by the source's media time, which the clip shares, so it copies without retiming.
