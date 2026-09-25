# Multicam

mcut's multicam is a live-switching model. One element holds several synced sources,
and a list of **angle cuts** says which **layout** (composition) is on screen from
each moment until the next cut. A layout is more than "camera 2". It places any
subset of sources in normalized rects (full-screen camera, screen with camera PiP,
side-by-side, and so on).

A multicam is a media clip like a video. `trimElement`, `trimEdge`, `splitElement`,
`slipElement`, `setElementSpeed`, `setTimeMap`, volume, mute, fades, and `detachAudio`
work on it the same way. Trims, slips, and speed changes move the clip's window over
the synced sources. Angle cuts and source sync stay put.

## Building one

1. Place the sources as ordinary clips, aligned on the timeline. Sources can be video
   and audio elements, and at least one must be video. An audio source is never drawn
   and can carry the program audio.
2. `createMulticam { sources: [{ elementId, key? }], audioSource?, multicamId? }`.
   The sources are synced as placed on the timeline. Clips recorded together and placed
   at the same start sync at offset 0. Sources must play at 1x forward. The element
   spans the placed clips, cut short to the shortest source, and the originals are
   removed.
3. Without a `key`, two videos become "screen" (bottom layer) and "camera" (top
   layer), one video is "camera", more are "cam-1", "cam-2", and so on, and an audio
   element is "audio". Layout slots match on these keys. `audioSource` defaults to
   the first audio-only source, then "camera", then the first source.
4. Default layouts are seeded **only if the project has none**. Seeded ids are
   random. `saveLayout` your own fixed-id layouts first when determinism matters.
   The `multicam-podcast` template does exactly this: `lay-screen-cam`,
   `lay-camera`, `lay-screen`, `lay-side-by-side`.
5. Fix sync if needed. `setMulticamSourceOffset { sourceKey, offsetMs }` nudges one
   source. `offsetMs` is the source's media time at source clock 0. Trims, splits,
   slips, and speed changes never change it.

## The source clock

Angle cuts sit on the **source clock**, the synced time every source shares. The
multicam's `trimStartMs` is its in-point on that clock. At 1x forward, a timeline time
`t` is at source clock `trimStartMs + (t - startMs)`. A speed change or a reverse
changes that mapping. The cuts keep their source clock times, so each cut stays on
the same moment of the recording.

The project summary lists cuts at element-local seconds, where the clip's viewer sees
them. The angle commands take `atMs` on the source clock. Read those values from the
element's `angles` list.

## Switching

- `addAngleCut { elementId, atMs, layoutId }` cuts at a source clock time. The layout
  holds until the next cut. The first cut opens the schedule. It cannot move or be
  removed.
- `moveAngleCut { fromMs, toMs }` and `removeAngleCut { atMs }` retime or drop cuts.
  `setAngleLayout { atMs, layoutId }` swaps the composition of the span that starts
  at `atMs` without adding a cut.
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
  "fit": "cover", "cornerRadius": 0.12, "shadow": { "blur": 36, "offsetY": 12 } }
```

Rects are 0-1 of the project frame. The first slot paints bottom. A slot takes the
same frame style as a video clip (`crop`, `cornerRadius`, `stroke`, `shadow`). `crop`
picks the source region that is fitted into the rect. Point it at the speaker's face
for tight crops. `removeLayout` refuses while any angle cut uses it.

Saving a layout merges each slot by source into the saved slot. An omitted field
keeps its value and `null` clears a frame style field, so
`{ "source": "camera", "rect": { ... } }` moves the camera and keeps its rounding
and shadow. Only a source new to the layout needs a `rect`. A source left out of
`slots` is removed, so list every slot you keep. `{ "source": "screen" }` is enough
for a slot you leave as is. An overlay new to the layout that sets none of
`cornerRadius`, `stroke`, and `shadow` gets the picture-in-picture look, a 0.12
corner radius and a soft shadow. The result lists each slot's geometry and style
changes and warns when an overlay loses its rounding or shadow, with the slot to
save to restore it.

To change a slot's size or aspect ("make the camera taller", "a 9:16 camera"), use
`resizeLayoutSlot { layoutId, source, aspect?, widthPx?, heightPx?, scale?, keep?,
anchor? }`. The slot stays anchored, to its corner for an overlay and to its center
for a full-frame or panel slot, so it does not jump across the frame. Every cut to
that layout changes.

When the speaker drifts inside a head overlay, call `center_person` on the live bridge
instead of hand-tuning the slot `crop`. It finds the face on device and writes one reframe
track on the `camera` source, the default, as one undo step. While the track exists, every
slot that shows that source slides its crop onto the face, and a slot without a crop slides
the part of the frame its fit shows. Each slot rect keeps its size and aspect and each crop
keeps its size, so only the framing inside the slot follows the face. `setReframe` with a
null `track` stops the follow and puts each crop back where the layout saved it.

## Switching rhythm (the editorial part)

- Cut on speaker changes and beats of the screen content, never mid-word.
- Hold every angle at least 2s. Favor the layout that shows what the audience needs
  (screen while demoing, camera for reactions, side-by-side for banter).
- Open on the establishing layout (screen plus PiP) so both sources register, then
  tighten.

## Flattening

`flattenMulticam` is destructive. It removes the multicam and explodes it into plain
clips per angle segment, plus an audio clip, with layout geometry baked into
transforms. Only undo restores the multicam. It requires 1x forward playback, so
flatten before a speed change or a reverse. Flatten only when you need per-segment
effects or trims the multicam cannot express. You lose live re-switching.
