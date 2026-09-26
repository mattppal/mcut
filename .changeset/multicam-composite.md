---
"@mcut/compositor": minor
---

A multicam composes its layout into the compose scratch, then draws that frame through the same image quad as a video clip. On the WebGPU backend its effects run on the GPU, chroma key, curves, and 3D LUTs included, and its blend mode applies against the layers below. Its opacity, blend mode, and effects apply once to the composed frame instead of to each slot. Its crop, corner radius, stroke, and shadow frame the composed frame the way they frame a clip, and an angle transition plays inside that frame. A zoom region without `source` zooms the composed frame inside the crop, the way a clip's zoom does, so it never shows composite the crop cuts away. Where no off screen canvas exists and no `createScratchContext` is given, a multicam draws nothing.
