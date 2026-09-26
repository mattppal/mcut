# Captions

Captions are first-class elements, not burned-in text. One `caption` element per
on-screen group, optional per-word timings for the karaoke highlight, styled by data.

## The pipeline

```
audio → transcription provider → TranscriptResult → group → applyCaptions
```

- `TranscriptResult` (from `@mcut/transcription`): `{ text, words: [{ text,
  startMs, endMs, confidence?, speaker? }], segments }`. Times are **source-media
  ms**. Any provider works (`@mcut/transcription-assemblyai`, AI-SDK adapter, or a
  hand-made JSON with only `words`).
- `groupWords(words, { maxChars = 36, maxDurationMs = 5000, maxGapMs = 800 })`
  chunks words into caption-sized groups. Speaker changes and long silences also
  start a new group.
- One `applyCaptions` command carries all caption elements, creates a "Captions"
  track when none exists, and clears old captions when `replace` is `true`.

## CLI and helpers

CLI (does grouping, styling, element scoping in one shot):

```sh
mcut captions project.json --transcript transcript.json \
  --element e-camera --style karaoke [--max-chars 36] [--replace] [--dry-run]
```

Programmatic: `buildCaptionsCommand(project, transcript, { elementId, styleId })`
from `@mcut/cli`, or `buildApplyCaptionsCommand(transcript, options)` from
`@mcut/transcription`.

## Scoping to a clip (the part everyone gets wrong)

A transcript covers the whole source file. A clip plays a slice of it, somewhere on
the timeline. Three options align them:

- `sourceStartMs` / `sourceEndMs` keep only words inside the clip's audio window.
  That window is the resolved audio asset, `trimStartMs` for a video or audio clip
  and the audio source offset plus `trimStartMs` for a multicam.
- `timeOffsetMs` is where that span sits on the timeline (the element's `startMs`).

`--element` (CLI) and `elementId` (programmatic) derive all three from the clip, including a multicam.
If you cut the clip after captioning, captions do not follow. Caption after
picture-lock, or re-run with `replace` set to `true`.

Captions require 1x playback on the scoped clip. A `timeMap` desyncs word timing.

## Styling

Style is a patch over caption defaults (`fontFamily sans-serif`, `fontSize 48`,
`fontWeight 700`, white on `rgba(0,0,0,0.55)`, `position` bottom). Named presets
ship in `assets/caption-styles.json` (generated from `CAPTION_STYLE_PRESETS`):
`classic`, `karaoke` (yellow active word), `spotlight` (dim text, white active word,
middle), `minimal`, `bold`, `banner`. `activeWordColor` is what switches on the
per-word highlight. Words must carry timings for it to mean anything.

Use `bottom` for 16:9. Use `middle` for 9:16 social, because platform chrome owns the
bottom quarter. See platforms.md.

## Subtitle files

For sidecar files instead of (or alongside) on-screen captions:
`toSrt(transcript)` / `toVtt(transcript)` from `@mcut/transcription`
(`transcriptToCues` prefers segments, falls back to grouped words).
