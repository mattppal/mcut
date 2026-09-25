---
"@mcut/mcp-server": minor
"@mcut/timeline": patch
---

`run_action` and `list_actions` name `file.export-video` for export. `apply_captions` warns when its transcript matches no captions in the project, so invented transcripts are visible, and it now fails without touching existing captions when the transcript yields no captions. `applyAnimationPreset` points to `effects.fade-open-close` for a fade in and out as one undo step.
