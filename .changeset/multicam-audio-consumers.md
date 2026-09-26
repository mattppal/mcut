---
"@mcut/editor": minor
"@mcut/transcription": minor
"@mcut/mcp-server": minor
"@mcut/cli": patch
---

Silence cuts, captions scoped to a clip, and audio activity read the clip's audio source, so a multicam uses its `audioSource` instead of being rejected as the wrong element type. A multicam with no audio source fails until `setMulticamAudio`. Reverse and trim-to-playhead treat a multicam as a media clip.
