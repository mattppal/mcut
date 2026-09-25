---
'@mcut/mcp-server': patch
---

The `find_retakes` tool description now tells the agent to rebuild captions once per remaining piece of the cut clip, passing `replace` true until a call reports OK. Because that call clears the caption track, the agent also takes a `find_retakes` transcript for every other captioned clip on that track before cutting and rebuilds those clips the same way.
