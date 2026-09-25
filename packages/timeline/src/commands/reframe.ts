import { z } from 'zod'
import { assertNever, CommandError } from '../errors'
import { elementIdSchema, type MulticamElement, type TimelineElement, type VideoElement } from '../model'
import { reframeTrackSchema, type ReframeTrack } from '../reframe'
import { cropSchema, type Crop } from '../style'
import { valueAt } from '../value-at'
import { defineCommand, mustLocate, replaceTrack } from './shared'

const payloadSchema = z.object({
  elementId: elementIdSchema,
  source: z
    .string()
    .min(1)
    .describe('Multicam source key whose framing follows the track, such as "camera". Required for a multicam, rejected for a video.')
    .optional(),
  track: reframeTrackSchema
    .nullable()
    .describe('Subject centers in increasing sourceMs (asset media time), x and y from 0 to 1 across the source frame. null removes tracking.'),
  crop: cropSchema.describe('Video only. The static window the track moves, as a normalized source rect.').optional(),
})

type ReframePayload = z.output<typeof payloadSchema>

const sameKeys = (current: ReframeTrack, next: ReframeTrack): boolean =>
  current.length === next.length &&
  current.every((key, index) => {
    const other = valueAt(next, index)
    return key.sourceMs === other.sourceMs && key.x === other.x && key.y === other.y
  })

function sameTrack(current: ReframeTrack | undefined, next: ReframeTrack | null): boolean {
  if (current === undefined || next === null) return current === undefined && next === null
  return sameKeys(current, next)
}

const sameCrop = (current: Crop | undefined, next: Crop): boolean =>
  current !== undefined && current.x === next.x && current.y === next.y && current.w === next.w && current.h === next.h

function setTrack(target: { reframe?: ReframeTrack | undefined }, track: ReframeTrack | null): void {
  if (track) target.reframe = track
  else delete target.reframe
}

function reframeVideo(element: VideoElement, payload: ReframePayload): VideoElement {
  if (payload.source !== undefined) {
    throw new CommandError('invalid-payload', `source applies only to multicam reframes; "${element.id}" is video`)
  }
  const cropUnchanged = payload.crop === undefined || sameCrop(element.crop, payload.crop)
  if (cropUnchanged && sameTrack(element.reframe, payload.track)) return element
  const next: VideoElement = { ...element }
  setTrack(next, payload.track)
  if (payload.crop) next.crop = payload.crop
  return next
}

function reframeMulticam(element: MulticamElement, payload: ReframePayload): MulticamElement {
  if (payload.crop !== undefined) {
    throw new CommandError('invalid-payload', 'crop applies only to video reframes; each multicam layout slot sets its own window')
  }
  const source = element.sources.find((s) => s.key === payload.source)
  if (!source) {
    const keys = element.sources.map((s) => s.key).join(', ')
    const problem = payload.source === undefined ? 'a multicam reframe needs source' : `multicam "${element.id}" has no source "${payload.source}"`
    throw new CommandError('invalid-payload', `${problem}, one of: ${keys}`)
  }
  if (sameTrack(source.reframe, payload.track)) return element
  const next = { ...source }
  setTrack(next, payload.track)
  return { ...element, sources: element.sources.map((s) => (s === source ? next : s)) }
}

function reframed(element: TimelineElement, payload: ReframePayload): TimelineElement {
  switch (element.type) {
    case 'video':
      return reframeVideo(element, payload)
    case 'multicam':
      return reframeMulticam(element, payload)
    case 'audio':
    case 'image':
    case 'text':
    case 'caption':
      throw new CommandError('invalid-payload', `"${element.type}" elements cannot be reframed; use a video or multicam element`)
    default:
      return assertNever(element)
  }
}

export const setReframe = defineCommand({
  type: 'setReframe',
  description:
    'Keep a subject centered in the framing window of a video or of one multicam source. ' +
    'track lists subject centers keyed by asset media time (sourceMs), with x and y as 0 to 1 fractions of the source frame, and the renderer slides the window onto each center, clamped inside the frame. ' +
    'Keys follow the media, so trims, splits, slips, and speed changes keep them aligned. ' +
    'On a video, crop sets the window size, and a video without a crop ignores the track. ' +
    'On a multicam, source names the angle, such as "camera", and each layout slot keeps its own window. ' +
    'track null removes tracking and keeps the crop. Writing the same track again is a no-op with no undo step.',
  payloadSchema,
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const next = reframed(element, payload)
    if (next === element) return project
    return replaceTrack(project, track.id, (t) => ({ ...t, elements: t.elements.map((e) => (e === element ? next : e)) }))
  },
})
