---
"@mcut/mcp-server": minor
---

Export runs as a job on the live bridge. `export_video` starts a render in Studio and returns a `jobId` at once, `get_export` reports the state, percent, and an ETA and long-polls with `waitMs` until the file is written, and `cancel_export` stops the render. The bridge writes the file itself, to `outputPath` or to `LiveBridgeOptions.exportDir` (default `~/Downloads`), so no download or save dialog opens. A second `export_video` while one runs fails with `export-busy`.
