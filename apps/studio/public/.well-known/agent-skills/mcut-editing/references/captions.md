# Captions

Captions are first-class elements (not burned-in text): one `caption` element per
on-screen group, optional per-word timings for the karaoke highlight, styled by data.

## The pipeline

```
audio → transcription provider → TranscriptResult → group → applyCaptions
```

- `TranscriptResult` (from `@mcut/transcription`): `{ text, words: [{ text,
  startMs, endMs, confidence?, speaker? }], segments }`. Times are **source-media
  ms**. Any provider works (`@mcut/transcription-assemblyai`, AI-SDK adapter, or a
  hand-made JSON with just `words`).
- `groupWords(words, { maxChars = 36, maxDurationMs = 5000, maxGapMs = 800 })`
  chunks words into caption-sized groups; speaker changes and long silences also
  start a new group.
- One `applyCaptions` command carries all caption elements, creates a "Captions"
  track when none exists, and clears old captions with `replace: true`.

## The easy paths

CLI (does grouping, styling, element scoping in one shot):

```sh
mcut captions project.json --transcript transcript.json \
  --element e-camera --style karaoke [--max-chars 36] [--replace] [--dry-run]
```

Programmatic: `buildCaptionsCommand(project, transcript, { elementId, styleId })`
from `@mcut/cli`, or `buildApplyCaptionsCommand(transcript, options)` from
`@mcut/transcription`.

## Scoping to a clip (the part everyone gets wrong)

A transcript covers the whole source file; a clip plays a slice of it, somewhere on
the timeline. Three options align them:

- `sourceStartMs` / `sourceEndMs` — keep only words inside the clip's source span
  (use the element's `trimStartMs` … `trimStartMs + durationMs`).
- `timeOffsetMs` — where that span sits on the timeline (the element's `startMs`).

`--element` (CLI) and `elementId` (programmatic) derive all three from the element.
If you cut the clip after captioning, captions do NOT follow — caption after
picture-lock, or re-run with `replace: true`.

Captions require 1x playback on the scoped clip (a `timeMap` desyncs word timing).

## Styling

Style is a patch over caption defaults (`fontFamily sans-serif`, `fontSize 48`,
`fontWeight 700`, white on `rgba(0,0,0,0.55)`, `position: bottom`). Named presets
ship in `assets/caption-styles.json` (generated from `CAPTION_STYLE_PRESETS`):
`classic`, `karaoke` (yellow active word), `spotlight` (dim text, white active word,
middle), `minimal`, `bold`, `banner`. `activeWordColor` is what switches on the
per-word highlight — words must carry timings for it to mean anything.

Position: `bottom` for 16:9; `middle` for 9:16 social (platform chrome owns the
bottom quarter — see platforms.md).

## Subtitle files

For sidecar files instead of (or alongside) on-screen captions:
`toSrt(transcript)` / `toVtt(transcript)` from `@mcut/transcription`
(`transcriptToCues` prefers segments, falls back to grouped words).
