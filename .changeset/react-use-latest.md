---
"@mcut/react": patch
---

Export `useLatest` from the sync hooks so app code can read the newest value of a prop or context inside a long-lived subscription without restarting it.
