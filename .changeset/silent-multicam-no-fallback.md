---
"@mcut/mcp-server": patch
---

`get_audio_activity` fails with setMulticamAudio when the selected multicam has no audio source, instead of analyzing another clip. With no selection it still uses the first clip that has source audio.
