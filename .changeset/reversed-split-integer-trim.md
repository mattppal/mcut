---
"@mcut/timeline": patch
---

Splitting or edge-trimming a reversed clip with a `timeMap` now writes an integer `trimStartMs` on the left half, so the project still passes `parseProject`.
