# Multicam

mcut's multicam is a live-switching model. One element holds several synced sources,
and a list of **angle cuts** says which **layout** (composition) is on screen from
each moment until the next cut. A layout is more than "camera 2". It places any
subset of sources in normalized rects (full-screen camera, screen with camera PiP,
side-by-side, and so on).

## Building one

1. Place the source videos as ordinary clips, aligned on the timeline. The bottom track
   is the "screen" role for two sources, the top is "camera", and audio follows the camera.
2. `createMulticam { elementIds: [...], multicamId? }`. Originals are removed. The
   element spans their union. Sources are synced by their current alignment.
   Default layouts are seeded **only if the project has none**. Seeded ids are
   random. `saveLayout` your own fixed-id layouts first when determinism matters.
   The `multicam-podcast` template does exactly this: `lay-screen-cam`,
   `lay-camera`, `lay-screen`, `lay-side-by-side`.
3. Fix sync if needed. `setMulticamSourceTrim { sourceKey, trimStartMs }` nudges one
   source's in-point (source time).

## Switching

- `addAngleCut { elementId, atMs, layoutId }` uses element-local time. The layout holds
  until the next cut. There is always an angle at 0.
- `moveAngleCut` / `removeAngleCut` retime or drop cuts. `setAngleLayout { index,
  layoutId }` swaps the composition without adding a cut.
- `setMulticamAngleTransition { transition | null }` is one style blended at every
  cut (Kdenlive-style mixer). `null` means hard cuts, the right default. When blending,
  keep the window at 300ms or less. Windows are clamped so neighbors never overlap.
- `setMulticamAudio { sourceKey | null }` takes audio from one source regardless
  of the visible layout (`null` mutes). Pin it once. Switching angles must never
  change the sound.
- `setMulticamSourceKey { sourceKey, newKey }` renames roles ('screen', 'camera',
  'cam-3', and so on). Layout slots match on these keys. If the key is taken the two swap.
  Audio follows the rename.

## Layouts

`saveLayout { layout: { id, name, slots } }`. Each slot:

```json
{ "source": "camera", "rect": { "x": 0.7, "y": 0.69, "w": 0.275, "h": 0.275 },
  "fit": "cover", "focus": { "x": 0.5, "y": 0.5 }, "cornerRadius": 0.12, "shadow": true }
```

Rects are 0-1 of the project frame. The first slot paints bottom. `focus` anchors the
crop when `fit` is `"cover"` (point it at the speaker's face for tight crops).
`removeLayout` refuses while any angle cut uses it.

## Switching rhythm (the editorial part)

- Cut on speaker changes and beats of the screen content, never mid-word.
- Hold every angle at least 2s. Favor the layout that shows what the audience needs
  (screen while demoing, camera for reactions, side-by-side for banter).
- Open on the establishing layout (screen plus PiP) so both sources register, then
  tighten.

## Flattening

`flattenMulticam` explodes the element into plain clips per angle segment, plus an
audio clip, with layout geometry baked into transforms. The step is one-way aside from undo.
Flatten only when you need per-segment effects or trims the multicam cannot express.
You lose live re-switching.
