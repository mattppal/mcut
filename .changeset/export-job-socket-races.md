---
"@mcut/mcp-server": patch
---

Fail an export whose Studio socket closes while the job is starting, ignore a replaced tab closing under a newer export, and keep a cancel during the file rename cancelled. The owner is the socket that carried start_export, so a reply crossing a tab swap cannot leave the job rendering, and a start that is still waiting can finish on the reconnected tab.
