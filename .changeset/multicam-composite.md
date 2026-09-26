---
"@mcut/compositor": minor
---

A multicam composes its layout into the compose scratch, then draws that frame through the same image quad as a video clip. On the WebGPU backend its effects run on the GPU, chroma key, curves, and 3D LUTs included, and its blend mode applies against the layers below. Its opacity, blend mode, and effects apply once to the composed frame instead of to each slot. Its crop, corner radius, stroke, and shadow frame the composed frame the way they frame a clip, and an angle transition plays inside that frame. A slot that reaches past the frame is cut at the frame. A zoom region without `source` still scales the whole composite before the crop cuts it.
