---
"@mcut/timeline": patch
"@mcut/editor": patch
---

Split the timeline command reducers into domain modules behind the same `commands` entry and route magnetic and gapped placement through one policy, with no change to command behavior.
