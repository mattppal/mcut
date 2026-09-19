---
"@mcut/timeline": patch
---

`trimEdge`, `rippleTrim`, `rollEdit`, and `slideElement` now reject a `deltaMs` whose resulting duration leaves the safe integer range with `CommandError` code `out-of-bounds`, instead of writing a `durationMs` that `parseProject` rejects.
