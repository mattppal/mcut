---
"@mcut/timeline": patch
"@mcut/editor": patch
"@mcut/compositor": patch
"@mcut/media": patch
"@mcut/mcp-server": patch
"@mcut/cli": patch
"@mcut/transcription": patch
---

Element, effect, transition, container, and renderer registries are now closed tables. `registerElement`, `registerEffect`, and the other register functions are removed. `engine.dispatch` takes `BuiltinCommand`.
