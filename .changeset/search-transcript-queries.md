---
'@mcut/transcription': minor
'@mcut/mcp-server': minor
'mcut-editing-skill': patch
---

`search_transcript` takes `queries`, more phrases to find in the same call, and replies with one entry in `results` per phrase. Matching ignores case and punctuation and runs across caption boundaries, so a phrase like "printer. And" that spans two captions is found. Each match carries the eight words before and after it and `pauseBeforeMs` and `pauseAfterMs`, so one search shows where a clause ends. `searchProjectTranscript` in `@mcut/transcription` is the one implementation the headless server and the Studio bridge share.
