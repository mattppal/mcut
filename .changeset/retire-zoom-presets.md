---
'@mcut/timeline': patch
---

Remove the keyframe zoom presets in favor of zoom regions. The `applyZoomPreset` command is gone, along with `ZOOM_PRESETS`, `ZOOMABLE_PROPERTIES`, `zoomPresetSchema`, `ZoomPreset`, `expandZoomPreset`, and `captureZoomPreset`. Add a punch-in with `addZoomRegion` instead.
