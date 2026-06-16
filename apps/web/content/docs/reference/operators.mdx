---
title: Operators
description: User-level editor intents from @mcut/editor.
---

Operators are UI-level editing actions layered on top of commands. They live in
`@mcut/editor` and compose timeline commands with playback, selection, and track
context.

## Tool names

The MCP server exposes operators as tools by replacing non-tool characters in the
operator id:

```text
operator_<id>
```

Examples:

| Operator id | MCP tool |
| --- | --- |
| `playback.seek` | `operator_playback_seek` |
| `edit.splitSelectionAtPlayhead` | `operator_edit_splitSelectionAtPlayhead` |
| `markers.toggleAtPlayhead` | `operator_markers_toggleAtPlayhead` |

Call `list_operators` to inspect the active operator set and current enabled
state before choosing a tool.

## Categories

| Category | Examples |
| --- | --- |
| Playback | toggle playback, seek, jump to start/end, step, jump to clip edges, shuttle |
| Selection | select all, select explicit ids, clear selection, select all clips on a track |
| Edit | split selection, split all tracks, delete, duplicate, ripple delete, trim, slide, slip, roll, reverse |
| Track | add track, delete current track, solo a track |
| Media | insert an asset at the playhead, export OpenTimelineIO |
| Keyframes | previous/next keyframe, toggle master keyframes, set/move/remove keyframes at a time |
| Markers | add/remove marker at playhead, jump to previous/next marker |
| Multicam | create a multicam element from selected clips |

## When to use operators

Use operators when an edit should behave like the editor UI:

- The current playhead matters.
- The current selection matters.
- The action should create tracks or choose placement the same way the UI does.
- The operation has an `enabled` precondition.

Use raw commands when you already know the target ids and exact payload.

## Enabled state

Operators can report disabled state and a disabled reason. Agents should treat a
disabled operator as a signal to inspect project state or choose a different
operation, not as a reason to retry the same call.
