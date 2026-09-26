---
"@mcut/mcp-server": patch
---

The `find_retakes` description says to pass the full, unchanged transcript to `apply_captions` once per remaining clip, never a slice, with `replace` true until a call reports OK. It also says to call `find_retakes` for every other captioned clip on the caption track before cutting and to rebuild each from that saved transcript.
