---
"@mcut/mcp-server": patch
---

`transact` rejects `edit.undo` and `edit.redo` before any call runs, whether they come as `operator_edit_undo`, `operator_edit_redo`, `run_operator`, or `run_action`. They used to run inside the transaction, so one transact could undo an earlier edit and still report one undo step. A failed call whose message already ends in a period no longer reports a double period.

`McutMcpTarget.transact` is optional, like the other members a custom target may leave out. A target without it keeps compiling, and the `transact` tool fails on it with `transact is not available on this target.`
