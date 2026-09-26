import { z } from 'zod'
import { resolveElementAudioSource } from '../audio-source'
import { CommandError } from '../errors'
import { createLinkId, createTrackId, type ElementId } from '../id'
import { createDefaultLayouts } from '../layouts'
import { getMediaSourceDurationMs } from '../media-clip'
import {
  captionStyleSchema,
  captionWordSchema,
  elementIdSchema,
  MIN_ELEMENT_DURATION_MS,
  trackIdSchema,
  validateElement,
  type AudioElement,
  type CaptionElement,
  type MulticamElement,
  type MulticamSource,
  type Project,
  type TimelineElement,
  type Track,
  type VideoElement,
} from '../model'
import { isAudioOnlySource } from '../multicam'
import { isTimelineMagnetic, placementFor } from '../placement'
import type { ElementLocation } from '../selectors'
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

interface PlacedSource {
  location: ElementLocation
  element: VideoElement | AudioElement
  key: string | undefined
}

function mustPlaceSources(project: Project, sources: readonly { elementId: ElementId; key?: string | undefined }[]): PlacedSource[] {
  const seen = new Set<ElementId>()
  return sources.map(({ elementId, key }) => {
    if (seen.has(elementId)) throw new CommandError('invalid-payload', `"${elementId}" is listed twice`)
    seen.add(elementId)
    const location = mustLocate(project, elementId)
    const { element } = location
    if (element.type !== 'video' && element.type !== 'audio') {
      throw new CommandError('invalid-payload', `"${element.id}" is not a video or audio element`)
    }
    if (element.timeMap || element.reversed) {
      throw new CommandError('invalid-payload', `multicam sources play at 1x forward; clear the speed and reverse on "${element.id}" first`)
    }
    return { location, element, key }
  })
}

function videoRoles(videos: readonly PlacedSource[]): string[] {
  if (videos.length === 1) return ['camera']
  if (videos.length === 2) {
    const screen = (videos[0]?.location.trackIndex ?? 0) <= (videos[1]?.location.trackIndex ?? 0) ? 0 : 1
    return videos.map((_, i) => (i === screen ? 'screen' : 'camera'))
  }
  return videos.map((_, i) => `cam-${i + 1}`)
}

function freeKey(preferred: readonly string[], taken: ReadonlySet<string>): string {
  const free = preferred.find((key) => !taken.has(key))
  if (free !== undefined) return free
  const base = preferred[0] ?? 'source'
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function withSourceKeys(placed: readonly PlacedSource[]): Array<PlacedSource & { key: string }> {
  const taken = new Set<string>()
  for (const { key } of placed) {
    if (key === undefined) continue
    if (taken.has(key)) throw new CommandError('invalid-payload', `two multicam sources share the key "${key}"`)
    taken.add(key)
  }
  const videos = placed.filter((source) => source.element.type === 'video')
  const roles = videoRoles(videos)
  return placed.map((source) => {
    if (source.key !== undefined) return { ...source, key: source.key }
    const role = roles[videos.indexOf(source)]
    const key = freeKey(role === undefined ? ['audio'] : [role, ...roles], taken)
    taken.add(key)
    return { ...source, key }
  })
}

function pickAudioSource(project: Project, sources: readonly MulticamSource[], requested: string | undefined): string | undefined {
  if (requested === undefined) {
    return (sources.find((source) => isAudioOnlySource(project, source)) ?? sources.find((source) => source.key === 'camera') ?? sources[0])?.key
  }
  if (!sources.some((source) => source.key === requested)) throw new CommandError('unknown-source', `no multicam source "${requested}"`)
  return requested
}

export const createMulticam = defineCommand({
  type: 'createMulticam',
  description:
    'Combine video and audio elements into one multicam clip whose layouts switch between the video sources. ' +
    '`sources` lists the elements, each with an optional role `key` that layout slots match on; at least one must be video. ' +
    'Without a key, two videos become "screen" (bottom layer) and "camera" (top layer), one video is "camera", more are ' +
    '"cam-1", "cam-2", and so on, and an audio element is "audio". An audio source is never drawn and can carry the program audio. ' +
    '`audioSource` names the source whose audio plays, defaulting to the first audio-only source, then "camera", then the first source. ' +
    'The sources are synced as placed on the timeline; clips recorded together and placed at the same start sync at offset 0. ' +
    'Sources must play at 1x forward. The multicam spans the placed clips, cut short to the shortest source, the originals ' +
    'are removed, and default talking-head layouts are seeded when the project has none.',
  payloadSchema: z.object({
    sources: z.array(z.object({ elementId: elementIdSchema, key: z.string().min(1).optional() })).min(1),
    audioSource: z.string().min(1).optional(),
    multicamId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const placed = withSourceKeys(mustPlaceSources(project, payload.sources))
    const host = placed.find((source) => source.element.type === 'video')
    if (!host) throw new CommandError('invalid-payload', 'a multicam needs at least one video source')

    const startMs = Math.max(...placed.map(({ element }) => element.startMs))
    const endMs = Math.min(...placed.map(({ element }) => element.startMs + element.durationMs))
    const anchorMs = placed.map(({ element }) => element.trimStartMs - element.startMs)
    const earliestAnchorMs = Math.min(...anchorMs)
    const trimStartMs = startMs + earliestAnchorMs
    const sources = placed.map(({ element, key }, index) => ({
      key,
      assetId: element.assetId,
      offsetMs: (anchorMs[index] ?? earliestAnchorMs) - earliestAnchorMs,
    }))

    const layouts = project.layouts.length > 0 ? project.layouts : createDefaultLayouts(project)
    const [opening] = layouts
    if (!opening) throw new CommandError('invalid-payload', 'a multicam needs at least one layout')
    const audioSource = pickAudioSource(project, sources, payload.audioSource)
    const element: MulticamElement = {
      id: mintElementId(project, payload.multicamId),
      type: 'multicam',
      startMs,
      durationMs: endMs - startMs,
      trimStartMs,
      sources,
      angles: [{ atMs: trimStartMs, layoutId: opening.id }],
      ...(audioSource === undefined ? {} : { audioSource }),
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      volume: 1,
      muted: false,
    }
    const coverageMs = getMediaSourceDurationMs(project, element)
    if (coverageMs !== undefined) element.durationMs = Math.min(element.durationMs, coverageMs - trimStartMs)
    if (element.durationMs < MIN_ELEMENT_DURATION_MS) {
      throw new CommandError('out-of-bounds', "the selected clips don't overlap in time; stack clips recorded together on separate tracks so they overlap")
    }
    validateElement(project, element)

    const ids = new Set(payload.sources.map((source) => source.elementId))
    const next = {
      ...project,
      layouts,
      tracks: project.tracks.map((t) => ({ ...t, elements: t.elements.filter((e) => !ids.has(e.id)) })),
    }
    const targetTrack = mustGetTrack(next, host.location.track.id)
    const policy = placementFor(targetTrack)
    policy.assertCanPlace(targetTrack, element)
    return replaceTrack(next, targetTrack.id, (t) => ({
      ...t,
      elements: policy.place(t, element),
    }))
  },
})

function withoutAudioMix<E extends VideoElement | MulticamElement>(element: E, linkId: string): E {
  const next: E = { ...element, muted: true, volume: 1, linkId }
  delete next.fadeInMs
  delete next.fadeOutMs
  if (next.keyframes?.volume) {
    const keyframes = { ...next.keyframes }
    delete keyframes.volume
    if (Object.keys(keyframes).length === 0) delete next.keyframes
    else next.keyframes = keyframes
  }
  return next
}

export const detachAudio = defineCommand({
  type: 'detachAudio',
  description:
    'Detach the audio of a video or multicam element onto its own audio element; a multicam detaches its audio source. ' +
    'The original is muted, its volume, volume keyframes, and fades move to the new audio element, which keeps the ' +
    'same window, speed, and reverse, and both share a `linkId` so UIs can select and move them together. Creates a ' +
    'track for the audio when `toTrackId` is omitted.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    toTrackId: trackIdSchema.optional(),
    audioElementId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (element.type !== 'video' && element.type !== 'multicam') {
      throw new CommandError('invalid-payload', `"${element.type}" elements have no audio to detach`)
    }
    if (element.muted) {
      throw new CommandError('invalid-payload', `${element.type} "${element.id}" is muted; nothing to detach`)
    }
    const source = resolveElementAudioSource(project, element.id)
    if (!source) {
      const hint = element.type === 'multicam' ? '; setMulticamAudio picks one' : ''
      throw new CommandError('invalid-payload', `${element.type} "${element.id}" has no audio source to detach${hint}`)
    }
    const linkId = element.linkId ?? createLinkId()
    const volumeKeyframes = element.keyframes?.volume

    const audio: TimelineElement = {
      id: mintElementId(project, payload.audioElementId),
      type: 'audio',
      startMs: element.startMs,
      durationMs: element.durationMs,
      trimStartMs: source.sourceStartMs,
      assetId: source.assetId,
      volume: element.volume,
      muted: false,
      linkId,
      ...(source.timeMap ? { timeMap: source.timeMap } : {}),
      ...(source.reversed ? { reversed: true } : {}),
      ...(element.fadeInMs === undefined ? {} : { fadeInMs: element.fadeInMs }),
      ...(element.fadeOutMs === undefined ? {} : { fadeOutMs: element.fadeOutMs }),
      ...(volumeKeyframes ? { keyframes: { volume: volumeKeyframes } } : {}),
    }
    validateElement(project, audio)
    const original = withoutAudioMix(element, linkId)

    let next = replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? original : e)),
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
