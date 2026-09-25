---
"@mcut/timeline": patch
---

`createMulticam` keeps the sync of a clip placed after the others. Each source offset is that clip's media time at timeline 0 relative to the earliest source, and the multicam covers the span every source is placed on.
