---
'@mcut/mcp-server': minor
---

Add the `center_person` MCP tool. In a live bridge session it finds the face on device in the connected editor and keeps the person in frame as one undoable edit, on a video crop or on one multicam source, which defaults to `camera`. On a video whose crop matches the project aspect within 1%, it also scales the clip to fill the frame, and the optional `fill` input forces or disables that. It returns the target, the sample and key counts, the source range the keys cover, and whether it filled the frame. The live bridge waits for it as long as for `ensure_transcript`, and a headless server rejects it with a message that a live bridge is required. `McutMcpTarget` gains an optional `centerPerson` method.
