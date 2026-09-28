---
"@mcut/timeline": minor
"@mcut/transcription": minor
"@mcut/transcription-local": minor
"@mcut/transcription-assemblyai": minor
"@mcut/mcp-server": patch
---

Projects carry an optional `vocabulary` of names and terms, set with `updateProject { vocabulary }` and listed in `getProjectMediaContext` under `transcript.vocabulary`. `TranscribeOptions` takes `vocabulary`. Local Whisper passes it as a decoder prompt, so a name like "Grokbot" is spelled the way the list spells it, and AssemblyAI passes it as `keyterms_prompt`. `ensure_transcript` tells agents to set the vocabulary before transcribing when the user names people or products.
