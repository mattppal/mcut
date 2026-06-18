# Multicam

mcut's multicam is a live-switching model: one element holds several synced sources,
and a list of **angle cuts** says which **layout** (composition) is on screen from
each moment until the next cut. A layout is not just "camera 2" — it places any
subset of sources in normalized rects (full-screen camera, screen with camera PiP,
side-by-side, …).

## Building one

1. Place the source videos as ordinary clips, aligned on the timeline (bottom track
   = the "screen" role for two sources, top = "camera"; audio follows the camera).
2. `createMulticam { elementIds: [...], multicamId? }` — originals are removed, the
   element spans their union, sources are synced by their current alignment, and
   default layouts are seeded **only if the project has none** (seeded ids are
   random — `saveLayout` your own fixed-id layouts first when determinism matters;
   the `multicam-podcast` template does exactly this: `lay-screen-cam`,
   `lay-camera`, `lay-screen`, `lay-side-by-side`).
3. Fix sync if needed: `setMulticamSourceTrim { sourceKey, trimStartMs }` nudges one
   source's in-point (source time).

## Switching

- `addAngleCut { elementId, atMs, layoutId }` — element-local time; the layout holds
  until the next cut. There is always an angle at 0.
- `moveAngleCut` / `removeAngleCut` retime or drop cuts; `setAngleLayout { index,
  layoutId }` swaps the composition without adding a cut.
- `setMulticamAngleTransition { transition | null }` — ONE style blended at EVERY
  cut (Kdenlive-style mixer). `null` = hard cuts, the right default. When blending,
  keep ≤300ms; windows are clamped so neighbors never overlap.
- `setMulticamAudio { sourceKey | null }` — audio comes from one source regardless
  of the visible layout (null mutes). Pin it once; switching angles must never
  change the sound.
- `setMulticamSourceKey { sourceKey, newKey }` — rename roles ('screen', 'camera',
  'cam-3'…). Layout slots match on these keys; if the key is taken the two swap;
  audio follows the rename.

## Layouts

`saveLayout { layout: { id, name, slots } }`; each slot:

```json
{ "source": "camera", "rect": { "x": 0.7, "y": 0.69, "w": 0.275, "h": 0.275 },
  "fit": "cover", "focus": { "x": 0.5, "y": 0.5 }, "cornerRadius": 0.12, "shadow": true }
```

Rects are 0–1 of the project frame; first slot paints bottom. `focus` anchors the
crop when `fit: "cover"` (point it at the speaker's face for tight crops).
`removeLayout` refuses while any angle cut uses it.

## Switching rhythm (the editorial part)

- Cut on speaker changes and beats of the screen content, never mid-word.
- Hold every angle ≥2s; favor the layout that shows what the audience needs
  (screen while demoing, camera for reactions, side-by-side for banter).
- Open on the establishing layout (screen+PiP) so both sources register, then
  tighten.

## Flattening

`flattenMulticam` explodes the element into plain clips per angle segment (+ an
audio clip), with layout geometry baked into transforms — one-way (undo aside).
Flatten only when you need per-segment effects or trims the multicam can't express;
you lose live re-switching.
