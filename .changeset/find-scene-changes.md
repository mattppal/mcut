---
"@mcut/media": minor
"@mcut/mcp-server": minor
---

Find where the picture changes with `findSceneChanges`, and render a labelled thumbnail grid with `renderContactSheet`. Both read one video clip or one multicam source over a timeline range. Agents get them as the `find_scene_changes` and `get_contact_sheet` MCP tools on the live Studio bridge.

`find_scene_changes` compares 64 by 36 luma frames every `stepMs`, reports a change when the changed fraction of the picture passes the `sensitivity` threshold, and refines each change to the exact frame. It returns the changes and the stable segments between them.

`McutMcpTarget.findSceneChanges` and `getContactSheet` are optional. On a target without them, the tools fail with `find_scene_changes requires the live bridge connected to Studio.` and the same for `get_contact_sheet`.
