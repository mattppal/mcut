---
"@mcut/media": patch
---

Load Mediabunny on first use instead of at import. `inputFor` and `ContainerFormat.createOutputFormat` are async now, and `exportProject` and `getExportSupport` load the export pipeline on demand, so an app that imports `@mcut/media` for the preview pool no longer ships the demuxers, muxers, and export code in its startup bundle. `preloadMediabunny` warms the download after first paint.
