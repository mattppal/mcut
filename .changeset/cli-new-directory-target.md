---
"@mcut/cli": patch
---

`mcut new PATH` fails with `mcut: PATH is a directory` when PATH is an existing directory, with or without `--force`, instead of suggesting `--force` or printing a raw `EISDIR` error.
