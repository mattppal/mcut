---
name: mcut-editing
description: Edit video programmatically with the mcut engine — cut/trim/splice, silence removal, captions, multicam switching, keyframe animation, speed ramps, transitions, platform reformatting, and export. Use when asked to edit, assemble, caption, tighten, or repurpose a video using mcut, via the MCP server, the CLI, a headless script, or an in-app agent.
license: Apache-2.0
metadata:
  source: https://github.com/mattppal/mcut
---

# Editing video with mcut

This skill is about making edits, not integrating the SDK (for installing the editor
UI or wiring transcription, see the `mcut` skill at `../mcut/SKILL.md`). Everything
below drives one engine: a project document edited through serializable, zod-validated
commands. Invalid commands throw and change nothing — read errors, don't retry blind.

## Getting an engine

In preference order:

1. **MCP server** — `bunx -p @mcut/mcp-server mcut-mcp path/to/project.json`, or
   `bunx -p @mcut/mcp-server mcut-bridge mcp` for a live browser editor. Every
   command and editor operator becomes a tool; each edit returns a fresh project
   summary (your feedback loop) and persists the file or browser state. Best for
   interactive editing.
2. **CLI** — `bunx @mcut/cli help` (binary: `mcut`). File-based editing:
   `mcut apply project.json commands.json`, plus computed edits no one should do by
   hand (`silence-cuts`, `captions`) and `validate`/`summarize`/`new`.
3. **Headless script** — `import { EditorEngine } from '@mcut/timeline'` in Node/Bun;
   `engine.dispatch(command)`, `engine.transact(fn)` for one undo step.
4. **In-app agent** — Vercel AI SDK tools from the command registry (the repo's
   `examples/agentic-editing`).

**The one hard constraint:** export is browser-only (WebCodecs). Headless work
produces `project.json`; a browser — the mcut editor UI or any page calling
`exportProject()` from `@mcut/media` — renders the MP4/WebM/MKV. See
[references/export.md](references/export.md).

## The editing loop

1. **Look first.** `get_summary` (MCP) / `mcut summarize` before any edit. In live
   bridge mode, also call `get_media_context` and `get_transcript` before
   content-aware edits. Note ids: elements are `e-*`, tracks `t-*`, assets `a-*`,
   layouts `lay-*`.
2. **Register media.** `addAsset` with real `durationMs`/`width`/`height` (probe in a
   browser with `@mcut/media`'s `probeMedia`; headless, you supply metadata).
3. **Plan on paper.** Turn the request + transcript into a cut list (times in ms)
   BEFORE dispatching. If `get_transcript` is empty and speech context matters,
   call `ensure_transcript` in live bridge mode; it explicitly runs local Whisper
   in the connected browser and applies captions. Editing is sequencing decisions,
   not command trivia.
4. **Apply in transactions.** Group commands per editorial intent (one undo step):
   `engine.transact`, one `mcut apply` batch, or sequential MCP calls.
5. **Verify.** Re-read the summary; run `mcut validate` (lints missing assets,
   overlaps, orphaned transitions, broken multicam refs). Undo exists — use it.
6. **Export** from a browser when the timeline is right.

## Time and model invariants (where edits go wrong)

- **All times are integer milliseconds.** Frame-align to the project fps when it
  matters (`quantizeMsToFrame`).
- **Two clocks.** `startMs` and `splitElement.atMs` are *timeline-absolute*.
  Keyframes, angle cuts, timeMaps, and `applyZoomPreset.atMs` are *element-local*
  (0 = clip start) — animations travel with the clip.
- **A third clock for sources.** `trimStartMs` offsets into the source media;
  transcripts speak source time. Timeline position = `element.startMs +
  (sourceMs - trimStartMs)` at 1x.
- **No overlaps on a track.** Tracks render bottom-up (last in list paints on top).
  Put titles/captions on top tracks, music on a bottom track.
- **Transitions live on the LEFT clip** of an exactly-adjacent (butt-cut) pair.
- **`rippleDelete` closes gaps; `removeElement` leaves them.** Ripple is per-track.
- Transforms are center-origin. `scaleX/scaleY` are multipliers from the asset's
  natural pixels to canvas pixels, not percentages of the project. A 3840x2160
  video fit into a 1920x1080 project has scale 0.5; that is "fit to canvas",
  not "half size." Read asset dimensions before scale/crop edits.
- The first keyframe **arms** a property: it is then driven only by keyframes
  (Premiere stopwatch). `easing` shapes the curve *toward the next* keyframe.

Full model: [references/model.md](references/model.md). Every command with payloads:
[references/commands.md](references/commands.md).

## Intent → recipe

Tested command sequences (replayed in CI) live in
[references/recipes.md](references/recipes.md):

| The user says | Recipe / reference |
| --- | --- |
| "cut out 0:30–0:33" | recipes: jump-cut |
| "remove the silences / tighten it up" | recipes: silence-cut (CLI) |
| "zoom in on the speaker" | recipes: punch-in |
| "start audio before the picture" | recipes: j-cut |
| "add a title" | recipes: intro-title |
| "freeze frame / speed up" | recipes: freeze-frame, speed-up |
| "caption this" | recipes: captions-karaoke + [captions.md](references/captions.md) |
| "switch cameras / picture-in-picture" | recipes: multicam-switching + [multicam.md](references/multicam.md) |
| "make the photos move" | recipes: ken-burns-slideshow |
| "make a vertical/TikTok version" | recipes: vertical-reframe + [platforms.md](references/platforms.md) |
| "animate / fade / pop" | [animation.md](references/animation.md) |
| "render / export it" | [export.md](references/export.md) |

Starter documents (talking-head, multicam-podcast, slideshow) are in
`assets/templates/` — valid projects with placeholder media srcs and stable ids.

## Editorial defaults

Apply these without being asked; deviate when the user directs.

- **Cuts are the default transition.** Reserve dissolves for mood/time shifts,
  300–500ms; never stack different transition types in one piece.
- **Pace:** vary shot length, 3–8s; cut on action or speech boundaries, never
  mid-word (the transcript gives you word edges).
- **Audio:** fade music edges 100–200ms with volume keyframes; duck music under
  speech (~0.15–0.3 volume); after `detachAudio`, the pair stays linked — move both.
- **Titles:** hold ≥1.5s per line; one in-preset + one out-preset, not three.
- **Captions:** ≤36 chars/group, word-karaoke on for social; bottom position except
  9:16, where chrome forces middle placement (see platforms.md).
- **Multicam:** switch on speaker change, hold an angle ≥2s, audio pinned to one
  source.
- **9:16 safe areas:** keep text out of the top ~10% and bottom ~25%.

## Before you call it done

- `mcut validate project.json` exits clean (no missing assets, overlaps, orphaned
  transitions, broken multicam layouts).
- No accidental gaps: elements you tightened sit butt-cut (ripple, not remove).
- Caption text stays inside the frame and safe areas at the project's dimensions.
- Project `width`/`height`/`fps` match the delivery platform
  ([platforms.md](references/platforms.md)).
- Report what you changed in editorial terms (cuts made, seconds removed, captions
  added), not command names.
