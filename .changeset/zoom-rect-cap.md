---
'@mcut/timeline': patch
'@mcut/mcp-server': patch
---

A zoom `rect` now aims at its center and fills it only up to the preset scale, so a region never makes a detail zoom severe. MCP zoom edits warn when any zoom goes above 1.5x.
