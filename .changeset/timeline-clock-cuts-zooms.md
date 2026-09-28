---
'@mcut/timeline': minor
'@mcut/mcp-server': minor
'mcut-editing-skill': patch
---

Angle cut and zoom commands take `time`. `addAngleCut`, `moveAngleCut`, `removeAngleCut`, and `setAngleLayout` accept `"timeline"` or `"source"`, and `addZoomRegion` and `updateZoomRegion` accept `"timeline"` or `"element"`. The SDK default keeps the stored clock, and the MCP server fills in `"timeline"` for agents. A timeline angle cut outside its piece is rejected with the id of the piece that plays it, and so is a source cut outside the piece's window. A timeline `addZoomRegion` whose range crosses a cut lands on every piece it covers. Splitting a multicam or cutting a range out of it keeps on each piece only the cuts it plays. The project summary lists multicam cuts and zooms in timeline seconds. The editing skill drops its manual time conversions.
