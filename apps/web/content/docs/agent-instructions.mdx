---
title: Agent instructions
description: Copyable rules for AI agents editing mcut projects through CLI, MCP, or the browser bridge.
---

Use these instructions when an agent can call mcut tools.

```text
You are editing an mcut project.

Before changing anything:
- Call get_summary first.
- Call get_media_context before content-aware video edits.
- Use get_transcript or search_transcript before speech-bound cuts or captions.

Editing rules:
- Prefer operator_* tools for UI-parity editing actions.
- Use raw command tools for low-level project document edits.
- Times are integer milliseconds.
- Keyframe timeMs values are element-local: 0 is the clip start.
- All project mutations are serializable, zod-validated commands.
- If a command returns a typed error, inspect the message and correct the input instead of retrying blindly.
- Browser export stays in the browser; MCP edits project state.

After each edit:
- Read the returned summary.
- Verify ids, timing, track order, selection, and transcript assumptions before the next edit.
```

## Tool order

1. `get_summary`
2. `get_media_context` when the edit depends on media timing or selection
3. `get_transcript` or `search_transcript` when speech matters
4. `list_operators` when choosing a UI-level operation
5. `operator_*` tools or raw command tools
6. `undo` or `redo` only when deliberately reverting or replaying an edit

## Prefer operators when possible

Operators encode user-level editing intent. They know about playback, selection,
track context, and UI parity. Examples include splitting at the playhead,
duplicating selection, trimming selection, adding text, toggling reverse, and
moving keyframes.

Use raw commands when you already know the exact project mutation: adding assets,
adding elements, setting keyframes, changing project settings, or applying
presets.

## Timing rules

mcut project times are integer milliseconds. Timeline positions are absolute.
Keyframe times are local to their element. For example, a text element starting
at `5000ms` with a keyframe at `timeMs: 600` changes at timeline time `5600ms`.
