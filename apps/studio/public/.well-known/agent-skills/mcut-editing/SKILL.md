---
name: mcut-editing
description: Edit videos with mcut via the MCP server, live browser bridge, CLI, or headless scripts. Use when asked to transcribe, caption, remove silence, tighten speech, cut/trim/splice, add fades/transitions, animate, reformat, multicam-edit, or export an mcut project.
license: Apache-2.0
metadata:
  source: https://github.com/mattppal/mcut
---

# mcut editing rails

Use mcut tools directly. Do not use ffmpeg, ad hoc shell media analysis, or raw
JSON surgery when an mcut MCP tool or action exists.

## Use the live bridge first

**MCP server** access is the normal agent path.

For real media, transcription, silence removal, audio activity, in-editor
export, or current editor state, use the live bridge, not the file-only stdio
server. mcut Studio hosts the bridge at `http://127.0.0.1:44737/mcp` with the
token from the app's MCP menu. Developers running the editor as a browser tab
start the same bridge with `mcut-bridge start`.

Minimum loop:

1. `get_summary`
2. `get_media_context`
3. If speech matters, `get_transcript` with `includeWords: true`
4. If transcript is missing, `ensure_transcript`
5. `list_actions`
6. Prefer `run_action` high-level actions over raw commands
7. Re-read the returned summary and context and verify timing

## Required workflows

### Transcribe and remove silence

1. `ensure_transcript` for the target clip if captions or word timings are missing.
2. Optionally inspect with `get_transcript` / `search_transcript`.
3. Do outside research only to repair transcript text or names, not to detect
   media silence.
4. Run:

```json
{
  "actionId": "transcript.remove-silence",
  "input": {
    "elementId": "e-...",
    "minGapMs": 600,
    "paddingMs": 120,
    "trimEnds": true
  }
}
```

This action uses word-timed captions and timeline commands. If it says there is
no word-timed transcript, call `ensure_transcript`. Do not fall back to ffmpeg.

### Remove retakes

After `ensure_transcript`, call `find_retakes`. Each candidate is a timeline
range from the abandoned take to the start of the kept take. Read
`abandonedText` and skip any candidate that is a deliberate repetition. Cut the
kept ranges last to first, because each ripple delete shifts every later range.
Cut each with a split at both ends and a ripple delete, on the clip and on the
caption track together, or rerun `ensure_transcript` with `replace` set to true after
the cuts. Pass a lower `minMatchWords` only when a short restart was missed,
and check each extra candidate, since lower values match spoken lists.

### Fade from black or fade to black

Use the built-in preset action instead of hand-authoring opacity keyframes:

```json
{
  "actionId": "effects.fade-open-close",
  "input": {
    "elementId": "e-...",
    "durationMs": 500
  }
}
```

For clip-to-clip transitions, use `setTransition` only on the left clip of an
exact butt cut. Built-ins: `dissolve`, `fade-black`, `fade-white`, `slide-left`,
`slide-right`, `wipe-left`, `wipe-right`.

### Punch-ins and detail zooms

Use zoom regions, not scale keyframes. `list_zooms` returns every zoom, and
`edit_zooms` adds, updates, or removes any number of them as one undoable edit.

```json
{
  "edits": [
    { "type": "addZoomRegion", "elementId": "e-...", "zoom": { "preset": "subtlePunchIn", "source": "screen", "atMs": 0 } },
    { "type": "addZoomRegion", "elementId": "e-...", "zoom": { "preset": "detailZoom", "source": "screen", "atMs": 42000, "holdMs": 4000, "focus": { "x": 0.75, "y": 0.3 } } }
  ]
}
```

Keep zooms subtle (1.1x to 1.5x), keep `easeOutExpo`, and keep `motionBlur` on.
On a multicam, set `source` to the screen key so the camera overlay stays put.
Place a detail zoom over the words that discuss the region, found with
`search_transcript`. When asked to tone zooms down, lower `scale` rather than
removing zooms or turning off motion blur.

## Timing rules

- All project times are integer milliseconds.
- Timeline positions are absolute.
- Keyframes, angle cuts, time maps, and animation preset internals are
  element-local.
- Transcript word times from captions are timeline times. Silence cuts convert
  them back to source time for 1x clips.
- `trimStartMs` is source-media time.
- `rippleDelete` closes gaps. `removeElement` leaves gaps.
- Tracks render bottom-up. Later tracks appear on top.

## When to use raw commands

Use `apply_commands` or raw command tools only when there is no high-level
action or operator for the intent. Batch related commands in one transaction.

Common raw-command cases:

- add or register media assets
- place clips on tracks
- exact trims and splits when the times are already known
- `setTransition` for adjacent clip transitions
- project dimensions, fps, and platform setup

## References

Load only when needed:

- `references/model.md` for project model details.
- `references/commands.md` for exact command payloads.
- `references/animation.md` for presets, keyframes, and transitions.
- `references/captions.md` for transcript and caption shaping.
- `references/multicam.md` for multicam edits.
- `references/platforms.md` for delivery formats and safe areas.
- `references/export.md` for browser export.
