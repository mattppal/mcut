---
'@mcut/mcp-server': patch
'mcut-editing-skill': patch
---

`list_zooms` and the `edit_zooms` result report each zoom's `atMs` in timeline ms, the clock `edit_zooms` takes, instead of element-local ms. An agent that reads a zoom and writes its `atMs` back keeps it in place, and zooms on different pieces of a split multicam no longer show look-alike times that belong to different moments.
