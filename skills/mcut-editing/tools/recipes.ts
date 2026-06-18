/**
 * Executable recipes: each one is BOTH documentation (rendered into
 * references/recipes.md by generate.ts) and a test fixture (replayed against
 * its template by recipes.test.ts). If a command's schema or semantics
 * change, the recipe test breaks before the docs lie.
 */
import { buildCaptionsCommand, planSilenceCuts } from '@mcut/cli'
import type { AnyCommand, Project } from '@mcut/timeline'
import { SAMPLE_TRANSCRIPT } from './sample-transcript'
import { buildTemplate } from './templates'

export interface Recipe {
  id: string
  title: string
  /** The user phrasing this recipe answers. */
  intent: string
  /** Template id the commands run against. */
  template: string
  /** Markdown: why these commands, and which knobs to turn. */
  notes: string
  /**
   * Literal commands, replayable as-is (ids reference the template).
   * Computed recipes (silence cuts) use `apply` + `cli` instead.
   */
  commands?: AnyCommand[]
  /** CLI equivalent, shown alongside the commands. */
  cli?: string
  /** For computed edits that cannot be expressed as static commands. */
  apply?: (project: Project) => Project
  verify: (project: Project) => void
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function element(project: Project, id: string) {
  for (const track of project.tracks) {
    const found = track.elements.find((e) => e.id === id)
    if (found) return found
  }
  throw new Error(`no element "${id}"`)
}

function trackOf(project: Project, elementId: string) {
  const track = project.tracks.find((t) => t.elements.some((e) => e.id === elementId))
  if (!track) throw new Error(`no track holding "${elementId}"`)
  return track
}

export const RECIPES: Recipe[] = [
  {
    id: 'jump-cut',
    title: 'Cut a flub out of the middle',
    intent: '“remove the part from 0:30 to 0:33” / “cut out the mistake”',
    template: 'talking-head',
    notes:
      'Two splits isolate the bad take, then `rippleDelete` removes it AND closes the gap — ' +
      'later clips on the same track shift left. Plain `removeElement` would leave a hole. ' +
      'Naming the right-hand pieces (`rightElementId`) keeps follow-up commands deterministic. ' +
      'Ripple is per-track: if captions or music must stay in sync, cut them too (or add them after).',
    commands: [
      { type: 'splitElement', elementId: 'e-camera', atMs: 30000, rightElementId: 'e-flub' },
      { type: 'splitElement', elementId: 'e-flub', atMs: 33000, rightElementId: 'e-keep' },
      { type: 'rippleDelete', elementIds: ['e-flub'] },
    ],
    verify: (project) => {
      const track = trackOf(project, 'e-camera')
      assert(track.elements.length === 2, 'expected two pieces after the cut')
      const [left, right] = track.elements
      assert(left!.durationMs === 30000, 'left piece should end at the cut')
      assert(right!.startMs === 30000, 'ripple should close the gap (butt cut at 30s)')
      assert(
        right!.type === 'video' && right!.trimStartMs === 33000,
        'right piece should resume at source 33s',
      )
    },
  },
  {
    id: 'silence-cut',
    title: 'Remove silence and dead air',
    intent: '“cut the silences” / “tighten this up” / “remove the pauses”',
    template: 'talking-head',
    cli: 'mcut silence-cuts project.json --transcript transcript.json --element e-camera --min-gap 600 --padding 120',
    notes:
      'Dozens of millisecond-precise split points is exactly the work to delegate to the CLI: ' +
      'it finds word gaps in the transcript, pads each cut by 120ms so speech never clips, ' +
      'turns silences into split + rippleDelete (trailing silence into a trim), and applies ' +
      'cuts last-to-first so timeline positions stay valid. Add `--dry-run` to print the plan ' +
      'as commands JSON without writing. Requires 1x playback (no timeMap) on the element; ' +
      'transcript times are source-media times, so trims/offsets are handled for you. Cutting ' +
      'leading silence replaces the element id with a fresh one — re-read the summary after.',
    apply: (project) =>
      planSilenceCuts(project, 'e-camera', SAMPLE_TRANSCRIPT, { minGapMs: 600, paddingMs: 120 })
        .project,
    verify: (project) => {
      const track = project.tracks.find((t) => t.name === 'A-roll')
      assert(track, 'A-roll track should survive')
      const total = track.elements
        .filter((e) => e.type === 'video')
        .reduce((sum, e) => sum + e.durationMs, 0)
      assert(total < 90000, 'silence cuts should shorten the A-roll')
      assert(track.elements.length > 1, 'interior silences should split the clip')
      for (let i = 1; i < track.elements.length; i++) {
        const prev = track.elements[i - 1]!
        assert(
          track.elements[i]!.startMs === prev.startMs + prev.durationMs,
          'ripple should leave butt cuts, not gaps',
        )
      }
    },
  },
  {
    id: 'punch-in',
    title: 'Punch in on the speaker',
    intent: '“zoom in at 4 seconds” / “punch in for emphasis”',
    template: 'talking-head',
    notes:
      'A pair of keyframes per axis: the first keyframe arms the property (stopwatch on) and its ' +
      '`easing` shapes the curve TOWARD the second. 1.0 → 1.12 over 400ms with `easeOut` reads as ' +
      'a deliberate camera move; the zoom holds after the last keyframe. Times are element-local ' +
      '(0 = clip start), so the move survives the clip being dragged. To punch back out later, add ' +
      'another pair returning to 1.0.',
    commands: [
      { type: 'setKeyframe', elementId: 'e-camera', property: 'scale.x', timeMs: 4000, value: 1, easing: 'easeOut' },
      { type: 'setKeyframe', elementId: 'e-camera', property: 'scale.x', timeMs: 4400, value: 1.12 },
      { type: 'setKeyframe', elementId: 'e-camera', property: 'scale.y', timeMs: 4000, value: 1, easing: 'easeOut' },
      { type: 'setKeyframe', elementId: 'e-camera', property: 'scale.y', timeMs: 4400, value: 1.12 },
    ],
    verify: (project) => {
      const camera = element(project, 'e-camera')
      assert('keyframes' in camera && camera.keyframes, 'camera should have keyframes')
      const scaleX = camera.keyframes['scale.x']
      assert(scaleX?.length === 2, 'scale.x should hold two keyframes')
      assert(scaleX![1]!.value === 1.12, 'punch lands at 1.12x')
      assert(scaleX![0]!.easing === 'easeOut', 'first keyframe eases toward the second')
    },
  },
  {
    id: 'j-cut',
    title: 'J-cut: audio leads the picture',
    intent: '“start the audio before the video” / “make the intro feel less abrupt”',
    template: 'talking-head',
    notes:
      '`detachAudio` puts the clip\'s sound on its own element (the video mutes; both share a ' +
      '`linkId`). Delaying the VIDEO by 500ms while trimming its in-point by the same amount keeps ' +
      'picture and sound in sync — the audio simply starts first. The same shape against the next ' +
      'clip on a track gives the classic conversation J-cut; swap which element you delay for an L-cut.',
    commands: [
      { type: 'detachAudio', elementId: 'e-camera', audioElementId: 'e-camera-audio' },
      { type: 'trimElement', elementId: 'e-camera', startMs: 500, durationMs: 89500, trimStartMs: 500 },
    ],
    verify: (project) => {
      const video = element(project, 'e-camera')
      const audio = element(project, 'e-camera-audio')
      assert(video.type === 'video' && video.muted, 'video should be muted after detach')
      assert(audio.type === 'audio' && audio.startMs === 0, 'audio should keep leading at 0')
      assert(video.startMs === 500, 'video should start 500ms late')
      assert(video.linkId !== undefined && video.linkId === audio.linkId, 'pair should stay linked')
    },
  },
  {
    id: 'intro-title',
    title: 'Animated intro title',
    intent: '“add a title” / “put the video name on screen at the start”',
    template: 'talking-head',
    notes:
      'Titles get their own top track so they composite over everything. Presets EXPAND into ' +
      'editable keyframes and MERGE, so an in + an out preset compose on one element: `pop-in` ' +
      'animates the first ~350ms, `fade-out` the last. Hold a title at least 1.5s per line of ' +
      'text. Style is data — bump `fontSize`/`fontWeight` rather than stacking effects.',
    commands: [
      { type: 'addTrack', id: 't-titles', name: 'Titles' },
      {
        type: 'addElement',
        trackId: 't-titles',
        element: {
          id: 'e-title', type: 'text', startMs: 300, durationMs: 3200,
          text: 'Agents can edit video', style: { fontSize: 96, fontWeight: 800 },
        },
      },
      { type: 'applyAnimationPreset', elementId: 'e-title', preset: 'pop-in' },
      { type: 'applyAnimationPreset', elementId: 'e-title', preset: 'fade-out' },
    ],
    verify: (project) => {
      const title = element(project, 'e-title')
      assert(title.type === 'text', 'expected a text element')
      assert(title.keyframes?.opacity !== undefined, 'presets should arm opacity')
      const opacity = title.keyframes.opacity!
      assert(opacity[0]!.timeMs === 0, 'pop-in starts at clip start')
      assert(opacity[opacity.length - 1]!.timeMs === 3200, 'fade-out ends at clip end')
      assert(opacity[opacity.length - 1]!.value === 0, 'fade-out lands at 0 opacity')
    },
  },
  {
    id: 'freeze-frame',
    title: 'Freeze frame mid-clip',
    intent: '“freeze on my face at 5 seconds” / “hold that frame for 2 seconds”',
    template: 'talking-head',
    notes:
      'A timeMap maps element-local output time → source time (relative to `trimStartMs`); a flat ' +
      'segment is a freeze. Here playback is 1:1 until 5s, holds source 5s for two seconds, then ' +
      'runs 1:1 again — the clip duration stays 90s, so the last 2s of source fall off the end ' +
      '(extend `durationMs` first if you need them). Bezier-eased value changes between points ' +
      'give speed ramps; `setElementSpeed` is the shortcut for a constant change.',
    commands: [
      {
        type: 'setTimeMap',
        elementId: 'e-camera',
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 5000, value: 5000 },
          { timeMs: 7000, value: 5000 },
          { timeMs: 90000, value: 88000 },
        ],
      },
    ],
    verify: (project) => {
      const camera = element(project, 'e-camera')
      assert(camera.type === 'video' && camera.timeMap?.length === 4, 'timeMap should have 4 points')
      assert(
        camera.timeMap![1]!.value === camera.timeMap![2]!.value,
        'the flat segment is the freeze',
      )
      assert(camera.durationMs === 90000, 'a timeMap does not change timeline duration')
    },
  },
  {
    id: 'speed-up',
    title: 'Speed up the whole clip',
    intent: '“make this 1.25x” / “speed it up a little”',
    template: 'talking-head',
    notes:
      'Constant speed rescales the clip\'s timeline duration to play the same source span — 90s of ' +
      'source at 1.25x occupies 72s. The in-point is kept. Later clips on the track do NOT move; ' +
      'follow with `compactTrackGaps` (or cut the music to match) if the change opens a gap. ' +
      'Speed 1 removes the map.',
    commands: [{ type: 'setElementSpeed', elementId: 'e-camera', speed: 1.25 }],
    verify: (project) => {
      const camera = element(project, 'e-camera')
      assert(camera.durationMs === 72000, 'duration should rescale to 72s')
      assert(camera.type === 'video' && camera.timeMap !== undefined, 'a constant map is stored')
    },
  },
  {
    id: 'captions-karaoke',
    title: 'Word-highlight captions from a transcript',
    intent: '“caption this” / “add subtitles with the karaoke effect”',
    template: 'talking-head',
    cli: 'mcut captions project.json --transcript transcript.json --element e-camera --style karaoke',
    notes:
      'One `applyCaptions` command carries every caption: the transcript is grouped to caption ' +
      'length (≤36 chars by default), word timings ride along for the active-word highlight, and ' +
      'a "Captions" track is created when missing. Scoping to an element (the CLI\'s `--element`, ' +
      'or `timeOffsetMs`/`sourceStartMs`/`sourceEndMs` by hand) captions exactly the source span ' +
      'the clip plays, at its timeline position. The command below was built from the sample ' +
      'transcript with the `karaoke` style preset.',
    commands: [
      buildCaptionsCommand(buildTemplate('talking-head'), SAMPLE_TRANSCRIPT, {
        elementId: 'e-camera',
        styleId: 'karaoke',
      }),
    ],
    verify: (project) => {
      const captionTrack = project.tracks.find(
        (track) => track.elements.length > 0 && track.elements.every((e) => e.type === 'caption'),
      )
      assert(captionTrack, 'captions should land on their own track')
      const first = captionTrack.elements[0]!
      assert(first.type === 'caption' && first.words && first.words.length > 0, 'captions carry word timings')
      assert(first.style.activeWordColor !== undefined, 'karaoke style sets activeWordColor')
    },
  },
  {
    id: 'multicam-switching',
    title: 'Switch angles on a multicam',
    intent: '“cut to the camera when they start talking, back to the screen after”',
    template: 'multicam-podcast',
    notes:
      'Angle cuts are element-local times naming a LAYOUT (a composition), not just a camera: ' +
      'full-screen camera, screen + PiP, side-by-side are all layouts. The cut holds until the ' +
      'next one. `setMulticamAngleTransition` standardizes every cut (null = hard cuts — the ' +
      'right default; use ≤300ms when you do blend). Switch on speaker changes, never mid-word, ' +
      'and hold each angle ≥2s. Audio stays pinned to one source via `setMulticamAudio` so ' +
      'switching angles never changes the sound.',
    commands: [
      { type: 'addAngleCut', elementId: 'e-multicam', atMs: 8000, layoutId: 'lay-camera' },
      { type: 'addAngleCut', elementId: 'e-multicam', atMs: 16000, layoutId: 'lay-screen-cam' },
      {
        type: 'setMulticamAngleTransition',
        elementId: 'e-multicam',
        transition: { type: 'dissolve', durationMs: 300 },
      },
      { type: 'setMulticamAudio', elementId: 'e-multicam', sourceKey: 'camera' },
    ],
    verify: (project) => {
      const multicam = element(project, 'e-multicam')
      assert(multicam.type === 'multicam', 'expected the multicam element')
      assert(multicam.angles.length === 3, 'an angle at 0 plus two cuts')
      assert(multicam.angles[1]!.layoutId === 'lay-camera', 'cut to camera at 8s')
      assert(multicam.angleTransition?.type === 'dissolve', 'uniform dissolve at every cut')
      assert(multicam.audioSource === 'camera', 'audio pinned to the camera')
    },
  },
  {
    id: 'ken-burns-slideshow',
    title: 'Ken Burns slideshow with dissolves',
    intent: '“make the photos move” / “turn these pictures into a video”',
    template: 'slideshow',
    notes:
      'Stills need motion: `ken-burns` is an emphasis preset spanning the whole clip (a slow ' +
      'push + drift, expanded into editable keyframes). Transitions live on the LEFT clip of ' +
      'each butt cut, so three photos need two `setTransition` calls. Dissolves at 500ms read ' +
      'as nostalgic; for energy, drop the dissolves and tighten each photo to 2–3s instead.',
    commands: [
      { type: 'applyAnimationPreset', elementId: 'e-photo-1', preset: 'ken-burns' },
      { type: 'applyAnimationPreset', elementId: 'e-photo-2', preset: 'ken-burns' },
      { type: 'applyAnimationPreset', elementId: 'e-photo-3', preset: 'ken-burns' },
      { type: 'setTransition', elementId: 'e-photo-1', transition: { type: 'dissolve', durationMs: 500 } },
      { type: 'setTransition', elementId: 'e-photo-2', transition: { type: 'dissolve', durationMs: 500 } },
    ],
    verify: (project) => {
      for (const id of ['e-photo-1', 'e-photo-2', 'e-photo-3']) {
        const photo = element(project, id)
        assert(
          'keyframes' in photo && photo.keyframes?.['scale.x'] !== undefined,
          `${id} should have ken-burns scale keyframes`,
        )
      }
      const first = element(project, 'e-photo-1')
      assert(
        'transition' in first && first.transition?.type === 'dissolve',
        'transition rides on the left clip',
      )
    },
  },
  {
    id: 'vertical-reframe',
    title: 'Reframe landscape for Shorts/TikTok',
    intent: '“make a vertical version” / “turn this into a Short”',
    template: 'talking-head',
    notes:
      'Two moves: retarget the project geometry, then rescale the footage to cover the new ' +
      'frame. A 1920×1080 source in a 1080×1920 canvas needs scale 1920/1080 ≈ 1.78 to cover ' +
      '(transforms are center-origin, so x/y default to centered — nudge `x` to reframe toward ' +
      'the subject). Keep text and captions inside the platform safe areas: chrome covers the ' +
      'top ~10% and bottom ~25% on TikTok/Shorts/Reels.',
    commands: [
      { type: 'updateProject', width: 1080, height: 1920 },
      {
        type: 'updateElement',
        elementId: 'e-camera',
        patch: { transform: { x: 0, y: 0, scaleX: 1.78, scaleY: 1.78, rotation: 0 } },
      },
    ],
    verify: (project) => {
      assert(project.width === 1080 && project.height === 1920, 'project should be 9:16')
      const camera = element(project, 'e-camera')
      assert(
        camera.type === 'video' && camera.transform.scaleX === 1.78,
        'footage should scale to cover',
      )
    },
  },
]
