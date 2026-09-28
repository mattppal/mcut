---
'@mcut/mcp-server': minor
'mcut-editing-skill': patch
---

`correct_transcript` takes `corrections`, a list of `find` and `replace` pairs, and applies them in order as one undo step, so every misspelling of a name is one call. The result names any pair that matched nothing. `transact` still rejects `correct_transcript`, because the correction also rewrites the stored transcript, and its error now points at `corrections`.
