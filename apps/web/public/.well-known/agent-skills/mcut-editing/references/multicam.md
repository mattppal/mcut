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

## Timeline time and the source clock

Give every angle cut and zoom in timeline ms, the time of the playhead, transcript
words, scene changes, and contact sheet tiles. The MCP tools convert it. The project
summary lists cuts after `cuts at timeline` and zooms after `zooms at timeline`, in
timeline seconds, so you can pass the cut times back as they are. A zoom spread over
a cut lists each piece's part, so read a zoom's own start from `list_zooms` as the
element's `startMs` plus `atMs`.

The element stores angle cuts on the **source clock**, the synced time every source
shares, so each cut stays on the same moment of the recording through trims, splits,
speed changes, and reverse. That is the element's `angles` list. Pass `time: "source"`
only when you give a value from that list, which a reversed piece requires.

## Switching

- `addAngleCut { elementId, atMs, layoutId }` cuts at a timeline time inside that
  piece. A time outside it is rejected with the id of the piece that plays it. The
  layout holds until the next cut. The first cut opens the schedule. It cannot move
  or be removed.
- `moveAngleCut { fromMs, toMs }` and `removeAngleCut { atMs }` retime or drop cuts,
  found by timeline time within one frame. `setAngleLayout { atMs, layoutId }` swaps
  the composition of the span that starts at `atMs` without adding a cut. At the
  piece's `startMs` it sets the opening shot.
- Cutting or splitting a multicam keeps on each piece only the cuts it plays, plus
  the neighbors an angle transition needs at its edges.
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

## Choosing shots (the editorial part)

A multicam edit is a shot list. Plan it from what the speaker says and what the screen
shows, then apply it in one pass. Never alternate angles on a fixed rhythm.

### Talking head with a screen recording

The default layouts include "Camera" (head only), "Screen + Cam" (screen full frame,
head in a corner), and "Screen" (screen only). This edit uses "Camera" and "Screen +
Cam".

1. Read the words. Cut retakes first with `find_retakes` and one `remove_ranges`, then
   call `apply_captions` with `elementId`, `replace` set to true, and no transcript, on
   its own. Then call `get_transcript` with `includeWords` set to true, so the word times
   match the cut timeline. Call `ensure_transcript` first if there is no transcript.
2. Read the screen. After the cuts the multicam is several pieces, one element each.
   Call `find_scene_changes` on the `screen` source and `get_contact_sheet` once per piece
   with its `elementId`, because both default to the first multicam.
3. Write the shot list before you change anything, one line per span with its timeline
   start, its layout, and the reason.
   - Open clean on "Camera". The first piece starts about 400ms before the first kept
     word, with no short shot and jump before it, and fades in from black over 500ms with
     `applyAnimationPreset` `fade-in` on that piece. The intro is the speaker talking to
     the viewer. Hold it until they turn to the screen.
   - Add the opening punch-in on the `camera` source at the first pause after the first
     sentence or two, not at 0s. A pause is a gap of about 300ms or more between words.
     Use the `subtlePunchIn` preset (1.15x, expo ease, motion blur). It lasts 3000ms, so
     it must end before the next angle cut, or the head overlay zooms too.
   - Cut to "Screen + Cam" when the speaker starts talking about what is on screen. Cues
     are words that point at it, such as "this", "here", "look at", "you can see", "my
     screen", "my computer", or the name of the app or page, spoken while a matching
     screen span is up. Cut in the word gap before that sentence starts, not on the cue
     word.
   - Prefer a retake cut as the cut to "Screen + Cam" when the lines after it are about the
     screen. The head jumps at a retake cut, and cutting away hides it. A speaker who is
     already looking at the screen is ready for the cut, even before the cue word.
   - Cut back to "Camera" when the speaker turns back to the viewer, for a story, an
     opinion, a summary, or the sign-off.
   - Hold each shot at least 2s. Merge a shorter span into its neighbor.
4. Match each shot list time to a piece. The times are timeline ms, and the tools take
   them as they are. Pass each angle cut to the piece whose window, from its `startMs`
   to `startMs + durationMs`, holds the time. Set each piece's opening shot with
   `setAngleLayout` at the piece's `startMs`. A zoom takes any piece on the track as
   `elementId`, and one that crosses a cut lands on each piece it covers.
5. Apply the whole list in one `transact`, the `addAngleCut` calls and the zoom
   regions, with `source` set on each zoom. Cut only in word gaps.
6. Check the result. Call `get_contact_sheet` with one time per shot, and compare the
   summary's `cuts at timeline` with the shot list.

When the words and the screen disagree, ask the user instead of guessing.

#### Worked example

A talking head about a printed daily report, with a screen share, after its retakes
are cut. Times are on the cut timeline.

- Open on the kept take. `find_retakes` returns 1.08s to 15.12s for the first
  abandoned take, after a silent lead-in from 0s. Cut 0s to 14.72s instead, so the video
  opens 400ms before "Each morning when I wake up", then fade that piece in from black.

- Cut at the start of the sentence that holds the screen cue, not on the cue word. The
  sentence "And the amazing thing is this report is generated entirely by Grokbot"
  starts at 20.2s while the report is up on screen, and "this report" comes at 21.1s.
  This sentence is the turn to the screen, so the opening "Camera" shot ends in the
  word gap just before 20.2s.
- Stay on "Screen + Cam" while the speaker keeps pointing at what is on screen, even
  when the screen content changes. At 30.3s a retake cut joins the report to the next
  sentence, "First, I got to give a shout out because I was really inspired by Karen
  Chang, who built something similar with her morning newspaper that she's sharing
  here." Her post is up from 30.3s, and "sharing here" at 39.7s points at it. Keep
  "Screen + Cam" from 20.2s through that sentence. Cutting back to "Camera" between the
  report and the post, or waiting until after "sharing here", misses the moment.
- Cut to the screen on a retake cut. The retake cut at 30.3s joins "how I built it."
  to the Karen Chang sentence, and the speaker is already looking at her post. If the
  shot before it is "Camera", cut to "Screen + Cam" right at 30.3s, not a sentence later.
  The retake cut at 144.0s leads into "Now, the neat thing is that Grokbot can execute
  commands on your computer" while the chat view is up, so cut to the screen there too.
- Merge a shot under 2s into its neighbor. Near the end the speaker says "print this
  page" at 251.4s and the page shows for about 1s. That reads as a flash, so keep the
  line on "Camera" unless the next screen span starts right after it.

### Other multicam edits

- Cut on speaker changes and beats of the screen content, never mid-word.
- Hold every angle at least 2s. Favor the layout that shows what the audience needs
  (screen while demoing, camera for reactions, side-by-side for banter).

## Flattening

`flattenMulticam` is destructive. It removes the multicam and explodes it into plain
clips per angle segment, plus an audio clip, with layout geometry baked into
transforms. Only undo restores the multicam. It requires 1x forward playback, so
flatten before a speed change or a reverse. Flatten only when you need per-segment
effects or trims the multicam cannot express. You lose live re-switching.
