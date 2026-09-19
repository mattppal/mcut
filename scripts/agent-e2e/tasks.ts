import type { BuiltinCommand, Project } from '@mcut/timeline'
import { resolveFixture, type Fixture } from './fixtures'
import type { ScriptedCall } from './model'
import {
  buttCutsFromZero,
  type Check,
  hasKeyframeNear,
  near,
  opacityKeyframes,
  sourceCovers,
  sourceTouches,
  textElements,
  totalDuration,
  trackIndexOf,
  verdictOf,
  videoClips,
} from './scoring'
import { syntheticSpeech, type SpeechScript } from './speech'
import type { E2ETask, ToolCall } from './types'

const ASSET_ID = 'a-clip'
const TRACK_ID = 't-video'
const CLIP_ID = 'e-clip'
const SPLIT_AT_MS = 1000
const FADE_MS = 400
const TITLE = 'Hello mcut'
const FADE_ACTION = 'effects.fade-open-close'
const SILENCE_ACTION = 'transcript.remove-silence'

const clip = resolveFixture('counter-vp9-webm')
const D = clip.durationMs

const call = (command: BuiltinCommand): ScriptedCall => {
  const { type, ...args } = command
  return { name: type, args }
}

const registerAsset = (fixture: Fixture): BuiltinCommand => ({
  type: 'addAsset',
  asset: {
    id: ASSET_ID,
    kind: fixture.kind,
    src: fixture.path,
    name: fixture.name,
    durationMs: fixture.durationMs,
    width: fixture.width,
    height: fixture.height,
  },
})

const addVideoTrack: BuiltinCommand = { type: 'addTrack', id: TRACK_ID, name: 'Video' }

const placeClip = (fixture: Fixture): BuiltinCommand => ({
  type: 'addElement',
  trackId: TRACK_ID,
  element: {
    id: CLIP_ID,
    type: 'video',
    assetId: ASSET_ID,
    startMs: 0,
    durationMs: fixture.durationMs,
  },
})

const placedClip = (fixture: Fixture): BuiltinCommand[] => [registerAsset(fixture), addVideoTrack, placeClip(fixture)]

const captionsFor = (speech: SpeechScript): BuiltinCommand => ({
  type: 'applyCaptions',
  captions: speech.groups.map((group) => ({
    startMs: group.startMs,
    durationMs: group.endMs - group.startMs,
    text: group.words.map((word) => word.text).join(' '),
    words: group.words.map((word) => ({
      text: word.text,
      startMs: word.startMs - group.startMs,
      endMs: word.endMs - group.startMs,
    })),
  })),
})

const speech = syntheticSpeech(D)
const [firstGroup, lastGroup] = speech.groups
const pad = speech.paddingMs
const actionGapMs = Math.floor(speech.minGapMs / 2)
const cover = Math.max(1080 / clip.width, 1920 / clip.height)
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

const ranAction = (transcript: readonly ToolCall[], actionId: string): boolean =>
  transcript.some((call) => call.name === 'run_action' && !call.isError && call.args.actionId === actionId)

const fadeChecks = (project: Project) => {
  const only = videoClips(project)[0]
  const frames = only === undefined ? [] : opacityKeyframes(only)
  const first = frames[0]
  const last = frames[frames.length - 1]
  return [
    ['the clip is still on the timeline', only !== undefined],
    ['opacity starts at 0', first?.timeMs === 0 && first.value === 0],
    [`opacity reaches 1 by ${FADE_MS} ms`, hasKeyframeNear(frames, FADE_MS, 1, 100)],
    [`opacity holds 1 until ${D - FADE_MS} ms`, hasKeyframeNear(frames, D - FADE_MS, 1, 100)],
    ['opacity ends at 0 at the clip end', last !== undefined && near(last.timeMs, D, 50) && last.value === 0],
  ] satisfies Check[]
}

const silenceChecks = (project: Project) => {
  const clips = videoClips(project)
  const words = speech.groups.flatMap((group) => group.words)
  return [
    ['the remaining clips butt together from 0', buttCutsFromZero(clips)],
    ['the edit is shorter than the source', totalDuration(clips) < D],
    ['every spoken word is still covered', words.every((word) => sourceCovers(clips, word.startMs, word.endMs))],
    ['the leading dead air is gone', !sourceTouches(clips, 0, firstGroup.startMs - pad, pad)],
    ['the silence between the two phrases is gone', !sourceTouches(clips, firstGroup.endMs + pad, lastGroup.startMs - pad, pad)],
    ['the trailing dead air is gone', !sourceTouches(clips, lastGroup.endMs + pad, D, pad)],
  ] satisfies Check[]
}

export const TASKS: E2ETask[] = [
  {
    id: 'import-and-place',
    title: 'Import the fixture and place it at 0',
    prompt:
      `Register the media file ${clip.path} as asset ${ASSET_ID} (kind ${clip.kind}, ` +
      `${clip.width}x${clip.height}, ${D} ms, name ${clip.name}). Add a video track, then place ` +
      `the whole clip on it starting at 0 ms for its full ${D} ms duration.`,
    target: 'any',
    fixtures: [clip.id],
    setup: [],
    scripted: [call(registerAsset(clip)), call(addVideoTrack), call(placeClip(clip))],
    score: (project) => {
      const asset = project.assets[ASSET_ID]
      const clips = videoClips(project)
      const only = clips[0]
      return verdictOf([
        [`asset ${ASSET_ID} is registered as video`, asset?.kind === 'video'],
        [`asset src is ${clip.path}`, asset?.src === clip.path],
        ['exactly one video clip is on the timeline', clips.length === 1],
        ['the clip references the asset', only?.assetId === ASSET_ID],
        ['the clip starts at 0', only?.startMs === 0],
        [`the clip runs the full ${D} ms`, only?.durationMs === D],
        ['the clip is not trimmed', only?.trimStartMs === 0],
      ])
    },
  },
  {
    id: 'split-and-drop-head',
    title: 'Split at 1 s and delete the first half',
    prompt:
      `The clip ${CLIP_ID} runs from 0 to ${D} ms. Split it at ${SPLIT_AT_MS} ms and delete the ` +
      'first part so the remaining footage starts at 0 ms with no gap before it.',
    target: 'any',
    fixtures: [clip.id],
    setup: placedClip(clip),
    scripted: [
      call({ type: 'splitElement', elementId: CLIP_ID, atMs: SPLIT_AT_MS, rightElementId: 'e-tail' }),
      call({ type: 'rippleDelete', elementIds: [CLIP_ID] }),
    ],
    score: (project) => {
      const clips = videoClips(project)
      const only = clips[0]
      return verdictOf([
        ['exactly one video clip remains', clips.length === 1],
        ['the remaining clip starts at 0', only?.startMs === 0],
        [`the remaining clip lasts ${D - SPLIT_AT_MS} ms`, only?.durationMs === D - SPLIT_AT_MS],
        [`the remaining clip resumes at source ${SPLIT_AT_MS} ms`, only?.trimStartMs === SPLIT_AT_MS],
      ])
    },
  },
  {
    id: 'title-overlay',
    title: 'Add a title over the clip',
    prompt:
      `Add a title that reads "${TITLE}" over the clip ${CLIP_ID}. Put it on a new track above ` +
      `the video track so it renders on top, starting at 0 ms and lasting the whole ${D} ms clip.`,
    target: 'any',
    fixtures: [clip.id],
    setup: placedClip(clip),
    scripted: [
      call({ type: 'addTrack', id: 't-titles', name: 'Titles' }),
      call({
        type: 'addElement',
        trackId: 't-titles',
        element: {
          id: 'e-title',
          type: 'text',
          startMs: 0,
          durationMs: D,
          text: TITLE,
          style: { fontSize: 96, fontWeight: 800 },
        },
      }),
    ],
    score: (project) => {
      const titles = textElements(project).filter((element) => element.text.toLowerCase().includes(TITLE.toLowerCase()))
      const title = titles[0]
      const above = title !== undefined && trackIndexOf(project, title.id) > trackIndexOf(project, CLIP_ID)
      return verdictOf([
        [`one text element reads ${TITLE}`, titles.length === 1],
        ['the title starts at 0', title?.startMs === 0],
        [`the title spans the ${D} ms clip`, title?.durationMs === D],
        ['the title track renders above the video track', above],
        ['the video clip is untouched', videoClips(project).length === 1],
      ])
    },
  },
  {
    id: 'silence-cuts',
    title: 'Cut silences from the transcript words',
    prompt:
      `The clip ${CLIP_ID} runs from 0 to ${D} ms with trimStartMs 0, so source time equals ` +
      `timeline time. It has word-timed captions. Words with source times in ms follow. ` +
      `${speech.describe()}. Remove the dead air before the first word and after the last word, ` +
      `and remove every silence between words longer than ${speech.minGapMs} ms. Keep ${pad} ms of ` +
      'padding on each side of the speech you keep, and close the gaps so the remaining pieces ' +
      'butt together starting at 0 ms. Leave the caption track alone.',
    target: 'any',
    fixtures: [clip.id],
    setup: [...placedClip(clip), captionsFor(speech)],
    scripted: [
      call({ type: 'splitElement', elementId: CLIP_ID, atMs: lastGroup.endMs + pad, rightElementId: 'e-tail' }),
      call({ type: 'removeElement', elementId: 'e-tail' }),
      call({ type: 'splitElement', elementId: CLIP_ID, atMs: lastGroup.startMs - pad, rightElementId: 'e-second' }),
      call({ type: 'splitElement', elementId: CLIP_ID, atMs: firstGroup.endMs + pad, rightElementId: 'e-gap' }),
      call({ type: 'rippleDelete', elementIds: ['e-gap'] }),
      call({ type: 'splitElement', elementId: CLIP_ID, atMs: firstGroup.startMs - pad, rightElementId: 'e-first' }),
      call({ type: 'rippleDelete', elementIds: [CLIP_ID] }),
    ],
    score: (project) => verdictOf(silenceChecks(project)),
  },
  {
    id: 'reformat-vertical',
    title: 'Reformat to 9:16',
    prompt:
      'Reformat this 1920x1080 project for vertical 9:16 delivery at 1080x1920. Scale the clip ' +
      `${CLIP_ID} (${clip.width}x${clip.height} source) so it covers the new frame completely ` +
      'and keep it centered.',
    target: 'any',
    fixtures: [clip.id],
    setup: [{ type: 'updateProject', width: 1920, height: 1080 }, ...placedClip(clip)],
    scripted: [
      call({ type: 'updateProject', width: 1080, height: 1920 }),
      call({
        type: 'updateElement',
        elementId: CLIP_ID,
        patch: { transform: { x: 0, y: 0, scaleX: round4(cover), scaleY: round4(cover), rotation: 0 } },
      }),
    ],
    score: (project) => {
      const only = videoClips(project)[0]
      const transform = only?.transform
      const covers = (scale: number | undefined): boolean => scale !== undefined && scale >= cover - 0.01 && scale <= cover * 1.25
      return verdictOf([
        ['the project is 1080x1920', project.width === 1080 && project.height === 1920],
        ['the clip is still on the timeline', only !== undefined],
        [`scaleX covers the frame (about ${round4(cover)})`, covers(transform?.scaleX)],
        [`scaleY covers the frame (about ${round4(cover)})`, covers(transform?.scaleY)],
        ['the clip stays centered', near(transform?.x ?? 1e9, 0, 1) && near(transform?.y ?? 1e9, 0, 1)],
      ])
    },
  },
  {
    id: 'fade-open-close',
    title: 'Fade in from black and out to black',
    prompt:
      `Fade the clip ${CLIP_ID} in from black over ${FADE_MS} ms at its start and out to black ` +
      `over ${FADE_MS} ms at its end, using opacity keyframes or the fade animation presets.`,
    target: 'any',
    fixtures: [clip.id],
    setup: placedClip(clip),
    scripted: [
      call({ type: 'applyAnimationPreset', elementId: CLIP_ID, preset: 'fade-in', options: { durationMs: FADE_MS } }),
      call({ type: 'applyAnimationPreset', elementId: CLIP_ID, preset: 'fade-out', options: { durationMs: FADE_MS } }),
    ],
    score: (project) => verdictOf(fadeChecks(project)),
  },
  {
    id: 'bridge-fade-action',
    title: 'Fade from and to black through the editor action',
    prompt:
      `Fade the clip ${CLIP_ID} in from black and out to black over ${FADE_MS} ms at each end by running ` +
      `the live editor action ${FADE_ACTION} through the run_action tool with input ` +
      `{"elementId": "${CLIP_ID}", "durationMs": ${FADE_MS}}. Do not author keyframes or presets by hand.`,
    target: 'bridge',
    fixtures: [clip.id],
    setup: placedClip(clip),
    scripted: [{ name: 'run_action', args: { actionId: FADE_ACTION, input: { elementId: CLIP_ID, durationMs: FADE_MS } } }],
    score: (project, transcript) =>
      verdictOf([[`the ${FADE_ACTION} action ran through run_action`, ranAction(transcript, FADE_ACTION)], ...fadeChecks(project)]),
  },
  {
    id: 'bridge-remove-silence-action',
    title: 'Remove transcript silence through the editor action',
    prompt:
      `The clip ${CLIP_ID} runs from 0 to ${D} ms with word-timed captions. Remove its silences by running ` +
      `the live editor action ${SILENCE_ACTION} through the run_action tool with input ` +
      `{"elementId": "${CLIP_ID}", "minGapMs": ${actionGapMs}, "paddingMs": ${pad}, "trimEnds": true}. ` +
      'Do not split or trim the clip by hand and leave the caption track alone.',
    target: 'bridge',
    fixtures: [clip.id],
    setup: [...placedClip(clip), captionsFor(speech)],
    scripted: [
      {
        name: 'run_action',
        args: {
          actionId: SILENCE_ACTION,
          input: { elementId: CLIP_ID, minGapMs: actionGapMs, paddingMs: pad, trimEnds: true },
        },
      },
    ],
    score: (project, transcript) =>
      verdictOf([[`the ${SILENCE_ACTION} action ran through run_action`, ranAction(transcript, SILENCE_ACTION)], ...silenceChecks(project)]),
  },
]

export function findTask(id: string): E2ETask | undefined {
  return TASKS.find((task) => task.id === id)
}
