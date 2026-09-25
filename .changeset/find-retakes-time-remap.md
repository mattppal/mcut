---
'@mcut/mcp-server': patch
---

`find_retakes` with `elementId` now rejects a clip with a time remap, as it already did a reversed clip. `apply_captions` cannot scope captions to such a clip, so the agent learns this before it cuts anything.
