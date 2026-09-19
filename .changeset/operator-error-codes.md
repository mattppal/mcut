---
"@mcut/editor": patch
---

Operators that reject their input now throw `OperatorError` with a code (`unknown-asset`, `unknown-element`, `invalid-payload`, `unsupported`, `out-of-bounds`) instead of a plain `Error`, so MCP clients get `OperatorError (code): message` for `media.insertAssetAtPlayhead`, the multicam asset checks, and silence cuts.
