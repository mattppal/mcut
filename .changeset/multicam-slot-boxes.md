---
"@mcut/compositor": minor
---

`getSlotBoxes` returns where a multicam shows each slot of its active layout at a timeline time, as the slot's source key and an oriented box in canvas pixels. Each box goes through the placement the renderer composes with, including the crop, a zoom region without `source`, and the transform. The box is cut where the renderer cuts the slot, so a hit test or an overlay lines up with the composed frame. A slot the frame shows none of has no box.
