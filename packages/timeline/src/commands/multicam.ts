import { z } from 'zod'
import { CommandError } from '../errors'
import { createElementId, createTrackId, type AssetId, type ElementId } from '../id'
import { elementIdSchema, MIN_ELEMENT_DURATION_MS, type Project, type TimelineElement, type Track } from '../model'
import { transitionSchema } from '../transitions'
import { listZoomRegions, renameSplitCopies, zoomRegionEndMs } from '../zoom-regions'
import { defineCommand, mustGetLayout, mustLocate, replaceTrack } from './shared'

function mustBeMulticam(element: TimelineElement): asserts element is TimelineElement & {
  type: 'multicam'
} {
  if (element.type !== 'multicam') {
    throw new CommandError('invalid-payload', `"${element.type}" elements have no angles/sources`)
  }
}

function withMulticam(project: Project, elementId: ElementId, update: (element: TimelineElement & { type: 'multicam' }) => TimelineElement): Project {
  const { track, element } = mustLocate(project, elementId)
  mustBeMulticam(element)
  const next = update(element)
  return replaceTrack(project, track.id, (t) => ({
    ...t,
    elements: t.elements.map((e) => (e.id === element.id ? next : e)),
  }))
}

export const addAngleCut = defineCommand({
  type: 'addAngleCut',
  description:
    'Cut a multicam to a layout at an element-local time: the layout is ' +
    'active from `atMs` until the next cut (the live-switching primitive — ' +
    'press a layout key while playing).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().nonnegative(),
    layoutId: z.string().min(1),
  }),
  reduce: (project, payload) => {
    mustGetLayout(project, payload.layoutId)
    return withMulticam(project, payload.elementId, (element) => {
      const angles = element.angles
        .filter((a) => a.atMs !== payload.atMs)
        .concat({ atMs: payload.atMs, layoutId: payload.layoutId })
        .sort((a, b) => a.atMs - b.atMs)
      return { ...element, angles }
    })
  },
})

export const moveAngleCut = defineCommand({
  type: 'moveAngleCut',
  description: 'Retime a multicam cut (drag its tick). Clamped between its neighbors.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    fromMs: z.number().int().nonnegative(),
    toMs: z.number().int().positive(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      const index = element.angles.findIndex((a) => a.atMs === payload.fromMs)
      if (index === -1) {
        throw new CommandError('unknown-cut', `no cut at ${payload.fromMs}ms`)
      }
      if (index === 0) {
        throw new CommandError('invalid-payload', 'the first cut is pinned to 0')
      }
      const previous = element.angles[index - 1]!
      const next = element.angles[index + 1]
      const toMs = Math.max(previous.atMs + 1, Math.min(payload.toMs, next ? next.atMs - 1 : element.durationMs - 1))
      const angles = element.angles.map((a, i) => (i === index ? { ...a, atMs: toMs } : a))
      return { ...element, angles }
    }),
})

export const removeAngleCut = defineCommand({
  type: 'removeAngleCut',
  description: 'Remove a multicam cut; the previous layout extends over its span.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().positive(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (!element.angles.some((a) => a.atMs === payload.atMs)) {
        throw new CommandError('unknown-cut', `no cut at ${payload.atMs}ms`)
      }
      return { ...element, angles: element.angles.filter((a) => a.atMs !== payload.atMs) }
    }),
})

export const setAngleLayout = defineCommand({
  type: 'setAngleLayout',
  description: 'Change which layout a multicam span uses without cutting (the paused ' + '"correct this take" action; `atMs` is the span\'s cut time).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().nonnegative(),
    layoutId: z.string().min(1),
  }),
  reduce: (project, payload) => {
    mustGetLayout(project, payload.layoutId)
    return withMulticam(project, payload.elementId, (element) => {
      const index = element.angles.findIndex((a) => a.atMs === payload.atMs)
      if (index === -1) {
        throw new CommandError('unknown-cut', `no cut at ${payload.atMs}ms`)
      }
      const angles = element.angles.map((a, i) => (i === index ? { ...a, layoutId: payload.layoutId } : a))
      return { ...element, angles }
    })
  },
})

export const setMulticamAudio = defineCommand({
  type: 'setMulticamAudio',
  description: 'Choose which multicam source supplies the audio (null mutes all sources).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    sourceKey: z.string().min(1).nullable(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (payload.sourceKey !== null && !element.sources.some((s) => s.key === payload.sourceKey)) {
        throw new CommandError('unknown-source', `no multicam source "${payload.sourceKey}"`)
      }
      const next = { ...element }
      if (payload.sourceKey === null) delete next.audioSource
      else next.audioSource = payload.sourceKey
      return next
    }),
})

export const setMulticamSourceTrim = defineCommand({
  type: 'setMulticamSourceTrim',
  description: "Nudge one multicam source's sync: its media time at the multicam's start (ms).",
  payloadSchema: z.object({
    elementId: elementIdSchema,
    sourceKey: z.string().min(1),
    trimStartMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (!element.sources.some((s) => s.key === payload.sourceKey)) {
        throw new CommandError('unknown-source', `no multicam source "${payload.sourceKey}"`)
      }
      return {
        ...element,
        sources: element.sources.map((s) => (s.key === payload.sourceKey ? { ...s, trimStartMs: payload.trimStartMs } : s)),
      }
    }),
})

export const setMulticamAngleTransition = defineCommand({
  type: 'setMulticamAngleTransition',
  description:
    'Standardize the cut style of a multicam: one transition blended at ' +
    'EVERY angle cut (null = hard jump cuts). Same vocabulary as clip ' +
    'transitions (dissolve, fade-black, …); each window is centered on its ' +
    'cut and clamped so neighboring windows never overlap.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    transition: transitionSchema.nullable(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.transition === null) delete next.angleTransition
      else next.angleTransition = payload.transition
      return next
    }),
})

export const setMulticamSourceKey = defineCommand({
  type: 'setMulticamSourceKey',
  description:
    "Reassign a multicam source's role key ('screen', 'camera', …) — the key " +
    'layout slots match on. If another source already holds `newKey` the two ' +
    'swap keys (audio stays with its role); on a plain rename the audio ' +
    'source follows the renamed key.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    sourceKey: z.string().min(1),
    newKey: z.string().min(1),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (!element.sources.some((s) => s.key === payload.sourceKey)) {
        throw new CommandError('unknown-source', `no multicam source "${payload.sourceKey}"`)
      }
      if (payload.newKey === payload.sourceKey) return element
      const taken = element.sources.some((s) => s.key === payload.newKey)
      const sources = element.sources.map((s) =>
        s.key === payload.sourceKey ? { ...s, key: payload.newKey } : taken && s.key === payload.newKey ? { ...s, key: payload.sourceKey } : s,
      )
      const rekey = (key: string | undefined) => (key === payload.sourceKey ? payload.newKey : taken && key === payload.newKey ? payload.sourceKey : key)
      const next = { ...element, sources }
      if (element.zooms) next.zooms = element.zooms.map((zoom) => ({ ...zoom, source: rekey(zoom.source) }))
      if (!taken && element.audioSource === payload.sourceKey) {
        next.audioSource = payload.newKey
      }
      return next
    }),
})

export const flattenMulticam = defineCommand({
  type: 'flattenMulticam',
  description:
    'Explode a multicam into plain clips: one video element per cut-span slot ' +
    '(on new tracks, layout geometry baked into transforms — approximate, no ' +
    'crop primitive) plus one audio element from the audio source. One-way; ' +
    'undo restores the multicam. Zooms on a source move onto the clips cut from that source.',
  payloadSchema: z.object({ elementId: elementIdSchema }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    mustBeMulticam(element)
    if (element.timeMap) {
      throw new CommandError('invalid-payload', 'flatten before changing speed (set speed 1, flatten, then re-apply)')
    }

    const maxSlots = Math.max(1, ...element.angles.map((a) => mustGetLayout(project, a.layoutId).slots.length))

    const spans = element.angles.map((cut, i) => ({
      cut,
      fromMs: cut.atMs,
      toMs: element.angles[i + 1]?.atMs ?? element.durationMs,
    }))

    const W = (assetId: AssetId) => project.assets[assetId]?.width ?? project.width
    const H = (assetId: AssetId) => project.assets[assetId]?.height ?? project.height

    const slotTracks: Track[] = Array.from({ length: maxSlots }, (_, i) => ({
      id: createTrackId(),
      name: `Multicam ${i + 1}`,
      muted: false,
      hidden: false,
      locked: false,
      magnetic: false,
      elements: [],
    }))

    const takenZoomIds = new Set(listZoomRegions(project).map((z) => z.id))
    for (const span of spans) {
      if (span.toMs - span.fromMs < MIN_ELEMENT_DURATION_MS) continue
      const layout = mustGetLayout(project, span.cut.layoutId)
      layout.slots.forEach((slot, slotIndex) => {
        const source = element.sources.find((s) => s.key === slot.source)
        if (!source) return
        const zooms = renameSplitCopies(
          (element.zooms ?? [])
            .filter((z) => z.source === slot.source && z.atMs < span.toMs && zoomRegionEndMs(z) > span.fromMs)
            .map(({ source: _source, ...zoom }) => ({ ...zoom, atMs: zoom.atMs - span.fromMs })),
          takenZoomIds,
        )
        const rw = slot.rect.w * project.width
        const rh = slot.rect.h * project.height
        const aw = W(source.assetId)
        const ah = H(source.assetId)
        const scale = slot.fit === 'cover' ? Math.max(rw / aw, rh / ah) : Math.min(rw / aw, rh / ah)
        slotTracks[slotIndex]!.elements.push({
          id: createElementId(),
          type: 'video',
          startMs: element.startMs + span.fromMs,
          durationMs: span.toMs - span.fromMs,
          assetId: source.assetId,
          trimStartMs: source.trimStartMs + span.fromMs,
          transform: {
            x: (slot.rect.x + slot.rect.w / 2 - 0.5) * project.width,
            y: (slot.rect.y + slot.rect.h / 2 - 0.5) * project.height,
            scaleX: scale,
            scaleY: scale,
            rotation: 0,
          },
          opacity: 1,
          volume: 1,
          muted: true,
          ...(zooms.length > 0 && { zooms }),
        })
      })
    }

    const audioSource = element.sources.find((s) => s.key === element.audioSource)
    const audioTrack: Track | null = audioSource
      ? {
          id: createTrackId(),
          name: 'Multicam audio',
          muted: false,
          hidden: false,
          locked: false,
          magnetic: false,
          elements: [
            {
              id: createElementId(),
              type: 'audio',
              startMs: element.startMs,
              durationMs: element.durationMs,
              assetId: audioSource.assetId,
              trimStartMs: audioSource.trimStartMs,
              volume: element.volume,
              muted: element.muted,
            },
          ],
        }
      : null

    const trackIndex = project.tracks.findIndex((t) => t.id === track.id)
    const tracks = project.tracks.map((t) => (t.id === track.id ? { ...t, elements: t.elements.filter((e) => e.id !== element.id) } : t))
    tracks.splice(trackIndex + 1, 0, ...slotTracks)
    if (audioTrack) tracks.splice(trackIndex, 0, audioTrack)
    return { ...project, tracks }
  },
})
