---
'@mcut/mcp-server': minor
---

Add the `center_person` MCP tool. In a live bridge session it finds the face on device in the connected editor and applies one undoable `setReframe` edit, on a video crop or on one multicam source, which defaults to `camera`. It returns the target, the sample and key counts, and the source range the keys cover. The live bridge waits for it as long as for `ensure_transcript`, and a headless server rejects it with a message that a live bridge is required. `McutMcpTarget` gains an optional `centerPerson` method.
