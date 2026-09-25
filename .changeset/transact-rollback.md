---
'@mcut/timeline': patch
'@mcut/mcp-server': patch
---

`EditorEngine.transact` now rolls back when its function throws. The project and selection return to where that `transact` began and no undo step is recorded, so `edit_zooms`, `apply_commands`, and `apply_captions` apply all of their commands or none. A nested `transact` that throws rolls back only its own dispatches.
