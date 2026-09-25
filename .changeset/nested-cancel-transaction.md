---
"@mcut/timeline": patch
---

`cancelTransaction` rolls back only the innermost open transaction and leaves any outer transaction open. It used to cancel every open level, so a failed MCP `transact` in Studio also discarded a text edit in progress. `loadProject` keeps open transactions open and restarts them from the loaded project.
