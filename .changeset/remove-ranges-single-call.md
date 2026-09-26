---
"@mcut/mcp-server": patch
---

The `remove_ranges` and `find_retakes` descriptions say to pass every chosen range to a single `remove_ranges` call, never one call per retake, so the whole cut is one undo step.
