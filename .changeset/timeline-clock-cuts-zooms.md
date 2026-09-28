---
'@mcut/timeline': minor
'@mcut/mcp-server': minor
'mcut-editing-skill': patch
---

Angle cut and zoom commands take `time`. `addAngleCut`, `moveAngleCut`, `removeAngleCut`, and `setAngleLayout` accept `"timeline"` or `"source"`, and `addZoomRegion` and `updateZoomRegion` accept `"timeline"` or `"element"`. The SDK default keeps the stored clock, and the MCP server fills in `"timeline"` for agents. A timeline angle cut outside its piece is rejected with the id of the piece that plays it, and so is a source cut outside the piece's window. A reversed piece takes cut times on the source clock only. A timeline `addZoomRegion` whose range crosses a cut lands on every abutting piece of the same media it covers, and `updateZoomRegion` only needs a region to overlap its element, so those copies stay editable. Splitting a multicam or cutting a range out of it keeps on each piece only the cuts it plays, plus the neighbors an angle transition needs at its edges. The project summary lists multicam cuts and zooms in timeline seconds. The editing skill drops its manual time conversions.

`ensure_transcript` and its `replace` field say to pass `replace` only when the user asks to redo the transcript or a tool says the captions lack word timings, so agents stop re-transcribing captions that already exist.
