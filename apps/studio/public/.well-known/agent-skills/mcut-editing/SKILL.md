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

For real media, transcription, silence removal, audio activity, face tracking,
frame grabs, in-editor export, importing local files, or current editor state, use the live
bridge, not the file-only stdio server. mcut Studio hosts the bridge at
`http://127.0.0.1:44737/mcp` with the
token from the app's MCP menu. Developers running the editor as a browser tab
start the same bridge with `mcut-bridge start`.

Minimum loop:

1. `get_summary`
2. `get_media_context`
3. If speech matters, `get_transcript` with `includeWords: true`
4. If transcript is missing, `ensure_transcript`
5. `list_actions`
6. Prefer `run_action` high-level actions and task tools such as `edit_zooms` and `center_person` over raw commands
7. When one user request needs more than one edit call, send them all in one
   `transact`, so "undo that" removes the whole request. "Make it square and
   fill the frame" is one request, not five calls
8. Re-read the returned summary and context and verify timing

## One intent, one undo step

One tool call is one undo step. `transact` runs a list of calls as that one
step. If any call fails, the project stays as it was and the undo stack does
not grow.

A fade in and a fade out are one intent. Send them together.

```json
{
  "name": "transact",
  "arguments": {
    "calls": [
      {
        "name": "applyAnimationPreset",
        "arguments": { "elementId": "e-video", "preset": "fade-in" }
      },
      {
        "name": "applyAnimationPreset",
        "arguments": { "elementId": "e-video", "preset": "fade-out" }
      }
    ]
  }
}
```

`undo` then removes both presets. Two separate `applyAnimationPreset` calls
undo one preset at a time. Each call is a timeline command, an `operator_*`
tool, `run_operator`, `run_action`, or `apply_commands`.

Import local recordings with `import_media` and absolute paths. `file.import`
opens a dialog for a person and imports nothing. `addAsset` cannot load a
`file:` URL.

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

After `ensure_transcript`, call `find_retakes` with the captioned clip's
`elementId`. Each candidate is a timeline range from the abandoned take to the
start of the kept take, and the reply's `transcript` holds that clip's words in
source time. Read `abandonedText` and skip any candidate that is a deliberate
repetition. Candidates come last to first, so cut them in the returned order,
each with a split at both ends and a ripple delete on the clip only. Do not cut
the caption track the same way, because a ripple delete keeps the gaps between
captions and leaves every later word late. Rebuild captions instead with one
`apply_captions` call per remaining clip, passing the reply's `transcript`
unchanged and that clip's `elementId`, with `replace` true on the first call
and false after. Pass a lower `minMatchWords` only when a short restart was
missed, and check each extra candidate, since lower values match spoken lists.

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

### Export a video

Export runs as a job on the live bridge. Studio renders the timeline and the
bridge writes the file, so no download or save dialog opens.

1. `export_video` with `{ "format": "mp4" }`, or with no input so Studio picks
   mp4 when it can encode H.264 and webm otherwise. Pass an absolute
   `outputPath` when the user names a file.
2. `get_export` with `{ "jobId": "...", "waitMs": 20000 }` until `state` is
   `done`. Each answer carries the percent and `etaMs`.
3. Report `outputPath` and `bytes` from the `done` answer.

`export-busy` means an export is already running. Wait for it with `get_export`
or stop it with `cancel_export`.

### See a frame before a zoom or a crop

Call `get_frame` before placing a zoom or a crop. Pass `timeMs` in timeline
milliseconds. The tool returns a PNG of that frame plus the ids of the
elements in it, so you can find a button or a region in a screen recording
before you set the zoom. Pass `elementId` to render one element. A multicam
element renders its composite. `maxWidth` defaults to 1280.

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

### Keep a person in frame

`center_person` finds the face on device and applies one undoable reframe. It
waits for the analysis, and the first run also downloads the face model.

```json
{
  "elementId": "e-...",
  "aspect": 0.5625,
  "smoothing": 0.5
}
```

On a video it crops to `aspect`, 9:16 by default, and the crop follows the face.
When that aspect is within 1% of the project aspect, it also scales the clip to
fill the frame and centers it in the same undo step. At another aspect the clip
keeps its size, as a picture in picture camera should. Pass `fill` true or false
to override. It never resizes the project, so for a vertical cut run
`updateProject` first, as in `references/platforms.md`. On a head overlay multicam
it follows the `camera` source by default and ignores `aspect` and `fill`. Raise
`smoothing` toward 1 for a steadier frame. Do not hand-author reframe keys or crop
with ffmpeg.

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
action or operator for the intent. Put every call that belongs to one intent
inside one `transact`.

Common raw-command cases:

- import local files with `import_media`, then place the returned asset ids
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
- `references/export.md` for containers, codecs, bitrates, and export outside Studio.
