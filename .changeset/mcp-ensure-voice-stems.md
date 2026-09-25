---
"@mcut/mcp-server": minor
---

Add the live bridge tool `ensure_voice_stems`. It cleans the voice of every clip with Clean up voice on, or of the clips in `elementIds`, in the connected browser tab and returns each clip's stem as `ready`, `processing`, or `failed`. By default it waits until every stem settles, and the bridge gives it the same long timeout as `ensure_transcript`. `wait: false` returns the current state at once. The headless server refuses it. `mcut-bridge ensure-voice-stems` calls it from a shell.
