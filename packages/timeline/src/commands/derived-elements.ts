import { z } from 'zod'
import { CommandError } from '../errors'
import { createLinkId, createTrackId } from '../id'
import { createDefaultLayouts } from '../layouts'
import {
  captionStyleSchema,
  captionWordSchema,
  elementIdSchema,
  MIN_ELEMENT_DURATION_MS,
  trackIdSchema,
  type CaptionElement,
  type TimelineElement,
  type Track,
} from '../model'
import { isTimelineMagnetic, placementFor } from '../placement'
import { applyThumbnailTemplate, thumbnailTemplateSchema } from '../thumbnails'
import { defineCommand, insertSorted, mintElementId, mustGetTrack, mustLocate, replaceTrack } from './shared'

const applyCaptionsSchema = z.object({
  trackId: trackIdSchema.optional(),
  replace: z.boolean().default(true),
  captions: z.array(
    z.object({
      id: elementIdSchema.optional(),
      startMs: z.number().int().nonnegative(),
      durationMs: z.number().int().min(MIN_ELEMENT_DURATION_MS),
      text: z.string(),
      words: z.array(captionWordSchema).optional(),
      style: captionStyleSchema,
    }),
  ),
})

export const applyCaptions = defineCommand({
  type: 'applyCaptions',
  description: 'Add caption elements (e.g. from a transcription) to a caption track, ' + 'creating the track when needed.',
  payloadSchema: applyCaptionsSchema,
  reduce: (project, payload) => {
    let next = project
    let trackId = payload.trackId
    if (trackId) {
      mustGetTrack(next, trackId)
    } else {
      const existing = next.tracks.find((t) => t.elements.length > 0 && t.elements.every((e) => e.type === 'caption'))
      if (existing) {
        trackId = existing.id
      } else {
        trackId = createTrackId()
        next = {
          ...next,
          tracks: [
            ...next.tracks,
            {
              id: trackId,
              name: 'Captions',
              muted: false,
              hidden: false,
              locked: false,
              magnetic: isTimelineMagnetic(next),
              elements: [],
            },
          ],
        }
      }
    }
    const finalTrackId = trackId
    if (payload.replace) {
      next = replaceTrack(next, finalTrackId, (t) => ({
        ...t,
        elements: t.elements.filter((e) => e.type !== 'caption'),
      }))
    }
    for (const caption of payload.captions) {
      const element: CaptionElement = {
        ...caption,
        id: mintElementId(next, caption.id),
        type: 'caption',
      }
      const track = mustGetTrack(next, finalTrackId)
      placementFor(track).assertCanPlace(track, element)
      next = replaceTrack(next, finalTrackId, (t) => ({
        ...t,
        elements: insertSorted(t.elements, element),
      }))
    }
    return next
  },
})

export const createMulticam = defineCommand({
  type: 'createMulticam',
  description:
    'Combine 1+ video elements into one multicam clip: sources are synced by ' +
    'their current timeline alignment, originals are removed, and the project ' +
    'is seeded with default talking-head layouts (screen + camera) when it has ' +
    'none. Source keys: with two sources the bottom layer becomes "screen" and ' +
    'the top layer "camera" (roles can be reassigned afterwards); audio follows ' +
    'the camera.',
  payloadSchema: z.object({
    elementIds: z.array(elementIdSchema).min(1),
    multicamId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const located = payload.elementIds.map((id) => mustLocate(project, id))
    const videos = located.map(({ element }) => {
      if (element.type !== 'video') {
        throw new CommandError('invalid-payload', `"${element.id}" is not a video element`)
      }
      return element
    })

    const startMs = Math.min(...videos.map((v) => v.startMs))
    const endMs = Math.max(...videos.map((v) => v.startMs + v.durationMs))

    let keys: string[]
    if (videos.length === 2) {
      const screen = located[0]!.trackIndex <= located[1]!.trackIndex ? 0 : 1
      keys = videos.map((_, i) => (i === screen ? 'screen' : 'camera'))
    } else if (videos.length === 1) {
      keys = ['camera']
    } else {
      keys = videos.map((_, i) => `cam-${i + 1}`)
    }

    let next = project
    if (next.layouts.length === 0) {
      next = { ...next, layouts: createDefaultLayouts() }
    }

    const sources = videos.map((video, i) => ({
      key: keys[i]!,
      assetId: video.assetId,
      trimStartMs: Math.max(0, video.trimStartMs - (video.startMs - startMs)),
    }))

    const audioKey = keys.includes('camera') ? 'camera' : keys[0]!
    const element: TimelineElement = {
      id: mintElementId(project, payload.multicamId),
      type: 'multicam',
      startMs,
      durationMs: endMs - startMs,
      sources,
      angles: [{ atMs: 0, layoutId: next.layouts[0]!.id }],
      audioSource: audioKey,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      volume: 1,
      muted: false,
    }

    const ids = new Set(payload.elementIds)
    next = {
      ...next,
      tracks: next.tracks.map((t) => ({ ...t, elements: t.elements.filter((e) => !ids.has(e.id)) })),
    }
    const targetTrack = mustGetTrack(next, located[0]!.track.id)
    const policy = placementFor(targetTrack)
    policy.assertCanPlace(targetTrack, element)
    return replaceTrack(next, targetTrack.id, (t) => ({
      ...t,
      elements: policy.place(t, element),
    }))
  },
})

export const detachAudio = defineCommand({
  type: 'detachAudio',
  description:
    "Detach a video element's audio onto its own audio element. The video is " +
    'muted, volume keyframes move to the new audio element, and both share a ' +
    '`linkId` so UIs can select/move them together. Creates a track for the ' +
    'audio when `toTrackId` is omitted.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    toTrackId: trackIdSchema.optional(),
    audioElementId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (element.type !== 'video') {
      throw new CommandError('invalid-payload', `"${element.type}" elements have no audio to detach`)
    }
    if (element.muted) {
      throw new CommandError('invalid-payload', `video "${element.id}" is muted; nothing to detach`)
    }
    const linkId = element.linkId ?? createLinkId()
    const volumeKeyframes = element.keyframes?.volume

    const audio: TimelineElement = {
      id: mintElementId(project, payload.audioElementId),
      type: 'audio',
      startMs: element.startMs,
      durationMs: element.durationMs,
      trimStartMs: element.trimStartMs,
      assetId: element.assetId,
      volume: element.volume,
      muted: false,
      linkId,
      ...(element.timeMap ? { timeMap: element.timeMap } : {}),
      ...(volumeKeyframes ? { keyframes: { volume: volumeKeyframes } } : {}),
    }
    const video: TimelineElement = { ...element, muted: true, volume: 1, linkId }
    if (video.type === 'video' && video.keyframes?.volume) {
      const keyframes = { ...video.keyframes }
      delete keyframes.volume
      if (Object.keys(keyframes).length === 0) delete video.keyframes
      else video.keyframes = keyframes
    }

    let next = replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? video : e)),
    }))

    if (payload.toTrackId) {
      const target = mustGetTrack(next, payload.toTrackId)
      const policy = placementFor(target)
      policy.assertCanPlace(target, audio)
      return replaceTrack(next, target.id, (t) => ({
        ...t,
        elements: policy.place(t, audio),
      }))
    }
    const audioTrack: Track = {
      id: createTrackId(),
      name: 'Audio',
      muted: false,
      hidden: false,
      locked: false,
      magnetic: isTimelineMagnetic(next),
      elements: [audio],
    }
    return { ...next, tracks: [audioTrack, ...next.tracks] }
  },
})

export const applyThumbnail = defineCommand({
  type: 'applyThumbnail',
  description:
    'Compose a cover over the first five frames: expands a thumbnail ' +
    'template\'s text items into one locked topmost "Thumbnail" track per ' +
    'text layer (existing thumbnail text is replaced; image layers stay). ' +
    'Unlike a metadata cover, this is baked into the exported video.',
  payloadSchema: z.object({ template: thumbnailTemplateSchema }),
  reduce: (project, payload) => applyThumbnailTemplate(project, payload.template),
})
