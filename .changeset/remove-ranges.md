---
"@mcut/timeline": minor
"@mcut/mcp-server": minor
---

New `removeRanges` command and `remove_ranges` MCP tool. One call removes a list of time ranges, in any order, from every unlocked track and closes the gaps as one undo step, so a multicam, its audio, and its captions stay in sync. `remove_ranges` takes timeline ranges such as `find_retakes` candidates, or source-media ranges of a clip's audio with `time: "source"`. The retake flow is `find_retakes`, then `remove_ranges`, then `apply_captions { elementId, replace: true }`.
