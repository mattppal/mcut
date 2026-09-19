---
"@mcut/timeline": patch
---

`transformSchema` rejects unknown keys. A transform patch such as `{ position, scale }` now fails with a typed error instead of parsing to the identity transform.
