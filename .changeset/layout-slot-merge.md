---
"@mcut/timeline": minor
"@mcut/mcp-server": minor
---

`saveLayout` merges each slot by source into the saved slot. An omitted field keeps its value, `null` clears a frame style field, and `rect` is required only for a source new to the layout, so re-saving a slot with a new rect keeps its corner radius and shadow. An overlay slot new to a layout that sets none of `cornerRadius`, `stroke`, and `shadow` gets the picture-in-picture look, a 0.12 corner radius and a soft shadow sized to the slot. The `saveLayout` and `resizeLayoutSlot` tool results list each style change field by field and warn when an overlay loses its corner radius or its shadow.
