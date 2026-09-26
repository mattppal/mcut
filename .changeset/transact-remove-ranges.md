---
"@mcut/mcp-server": patch
---

`transact` accepts `remove_ranges` with timeline ranges and runs it as one `removeRanges` command in the same undo step. With `time: "source"` inside `transact` it fails before anything changes. The `remove_ranges` description now says it is already one undo step on its own.
