---
"@mcut/timeline": minor
"@mcut/editor": minor
"@mcut/mcp-server": patch
---

`applyAnimationPreset` takes an element-local `atMs`. In and emphasis presets start there, out presets end there, clamped to fit the clip. `withPlayheadDefaults` fills `atMs` from the playhead when the playhead is on the clip, and the MCP server and `applyCommands` use it.
