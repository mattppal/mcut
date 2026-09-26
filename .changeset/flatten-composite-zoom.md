---
"@mcut/timeline": patch
---

`flattenMulticam` keeps a whole-composite zoom. Each flattened clip gets position and scale keyframes that move its box where its slot's box was under the zoom, and motion blur when the zoom had it.
