---
"@mcut/compositor": minor
---

`getSlotBoxes` returns where a multicam draws each slot of its active layout at a timeline time, as the slot's source key and an oriented box in canvas pixels under the multicam's crop and transform. It uses the renderer's own slot placement, so a hit test or an overlay lines up with the composed frame.
