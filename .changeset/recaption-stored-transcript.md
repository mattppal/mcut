---
'@mcut/mcp-server': patch
---

`apply_captions` accepts `elementId` without a `transcript` and reuses the word-timed transcript the server stored for that audio from `ensure_transcript`, `find_retakes`, or an earlier `apply_captions`. After retake cuts, the agent re-captions every piece without writing the transcript back out.
