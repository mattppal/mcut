---
"@mcut/media": minor
"@mcut/mcp-server": minor
---

Render one project frame to a PNG with `renderProjectStill`, and expose it to agents as the `get_frame` MCP tool on the live Studio bridge.

`McutMcpTarget.getFrame` is optional, like the other live-only members, so a custom target without it still compiles. `get_frame` on such a target fails with `get_frame requires the live bridge connected to Studio.`
