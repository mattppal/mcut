---
"@mcut/desktop-ipc": minor
---

New package. `DESKTOP_INVOKES` is the zod schema table for the four desktop IPC channels (`app.info`, `app.setTranscriptionKey`, `project.open`, `project.save`), `InvokeHandlers` is the mapped handler type over it, `desktopErrorSchema` and `DesktopError` carry the closed error codes across the process boundary, `DesktopApi` is the surface the preload exposes on `window.mcutDesktop`, and `readDesktopApi()` parses it or returns `null` in a plain browser.
