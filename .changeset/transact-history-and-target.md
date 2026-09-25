---
"@mcut/mcp-server": patch
---

`transact` rejects `edit.undo` and `edit.redo` before any call runs, whether they come as `operator_edit_undo`, `operator_edit_redo`, `run_operator`, or `run_action`. They used to run inside the transaction, so one transact could undo an earlier edit and still report one undo step.
