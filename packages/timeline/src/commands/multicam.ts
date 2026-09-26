import { z } from 'zod'
import { flattenSlotMotion } from '../composite-zoom'
import { CommandError } from '../errors'
import { createElementId, createTrackId, type AssetId, type ElementId } from '../id'
import { elementIdSchema, MIN_ELEMENT_DURATION_MS, validateElement, type Project, type TimelineElement, type Track } from '../model'
import { getVisibleAngleCuts, isAudioOnlySource } from '../multicam'
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
    'Cut a multicam to a layout. `atMs` is on the source clock, the synced group time every source shares ' +
    '(at 1x forward it is the multicam trimStartMs plus element-local ms), so cuts stay on the same content ' +
    'through trims, splits, speed changes, and reverse. The layout is active from `atMs` until the next cut ' +
    '(the live-switching primitive, press a layout key while playing).',
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
  description:
    'Retime a multicam cut (drag its tick). `fromMs` and `toMs` are on the source clock, like addAngleCut. ' +
    'Clamped between its neighbors. The first cut opens the schedule and cannot move.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    fromMs: z.number().int().nonnegative(),
    toMs: z.number().int().positive(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      const index = element.angles.findIndex((a) => a.atMs === payload.fromMs)
      const previous = element.angles[index - 1]
      if (index === -1) {
        throw new CommandError('unknown-cut', `no cut at ${payload.fromMs}ms`)
      }
      if (!previous) {
        throw new CommandError('invalid-payload', 'the first cut opens the schedule and cannot move; setAngleLayout changes its layout')
      }
      const next = element.angles[index + 1]
      const toMs = Math.max(previous.atMs + 1, Math.min(payload.toMs, next ? next.atMs - 1 : Infinity))
      const angles = element.angles.map((a, i) => (i === index ? { ...a, atMs: toMs } : a))
      return { ...element, angles }
    }),
})

export const removeAngleCut = defineCommand({
  type: 'removeAngleCut',
  description: 'Remove a multicam cut at `atMs` on the source clock; the previous layout extends over its span. The first cut cannot be removed.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      const index = element.angles.findIndex((a) => a.atMs === payload.atMs)
      if (index === -1) {
        throw new CommandError('unknown-cut', `no cut at ${payload.atMs}ms`)
      }
      if (index === 0) {
        throw new CommandError('invalid-payload', 'the first cut opens the schedule and cannot be removed; setAngleLayout changes its layout')
      }
      return { ...element, angles: element.angles.filter((a) => a.atMs !== payload.atMs) }
    }),
})

export const setAngleLayout = defineCommand({
  type: 'setAngleLayout',
  description:
    'Change which layout a multicam span uses without cutting (the paused "correct this take" action). ' + "`atMs` is the span's cut time on the source clock.",
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

export const setMulticamSourceOffset = defineCommand({
  type: 'setMulticamSourceOffset',
  description:
    "Nudge one multicam source's sync. `offsetMs` is that source's media time at group time 0 (ms). " +
    'Trims, splits, slips, and speed changes move the window over the group and never change it.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    sourceKey: z.string().min(1),
    offsetMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (!element.sources.some((s) => s.key === payload.sourceKey)) {
        throw new CommandError('unknown-source', `no multicam source "${payload.sourceKey}"`)
      }
      const next = {
        ...element,
        sources: element.sources.map((s) => (s.key === payload.sourceKey ? { ...s, offsetMs: payload.offsetMs } : s)),
      }
      validateElement(project, next)
      return next
    }),
})

export const setMulticamAngleTransition = defineCommand({
  type: 'setMulticamAngleTransition',
  description:
    'Standardize the cut style of a multicam: one transition blended at ' +
    'EVERY angle cut (null = hard jump cuts). Same vocabulary as clip ' +
    'transitions (dissolve, fade-black, …); each window is centered on its ' +
    'cut and clamped so neighboring windows never overlap. Windows are measured on the source clock, ' +
    'so a 2x multicam plays them in half the time.',
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
    'Destructive: removes the multicam and replaces it with plain clips, one muted video element per ' +
    'layout slot per visible cut span on new tracks (layout geometry baked into transforms, approximate, ' +
    'no crop primitive) plus one audio element from the audio source. The multicam, its angle schedule, ' +
    'and its effects are gone afterwards; only undo restores them. Zooms and the reframe track on a source ' +
    'move onto the clips cut from that source. A whole-composite zoom becomes position and scale keyframes on ' +
    'every clip it covers, so each box moves as its slot did, with motion blur on when the zoom had it. ' +
    'Requires 1x forward playback (no timeMap, not reversed).',
  payloadSchema: z.object({ elementId: elementIdSchema }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    mustBeMulticam(element)
    if (element.timeMap) {
      throw new CommandError('invalid-payload', 'flatten before changing speed (set speed 1, flatten, then re-apply)')
    }
    if (element.reversed) {
      throw new CommandError('invalid-payload', 'flatten before reversing (clear reversed, flatten, then re-apply)')
    }

    const cuts = getVisibleAngleCuts(element)
    const maxSlots = Math.max(1, ...cuts.map((cut) => mustGetLayout(project, cut.layoutId).slots.length))

    const spans = cuts.map((cut, i) => ({
      layoutId: cut.layoutId,
      fromMs: cut.localMs,
      toMs: cuts[i + 1]?.localMs ?? element.durationMs,
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
      const layout = mustGetLayout(project, span.layoutId)
      layout.slots.forEach((slot, slotIndex) => {
        const source = element.sources.find((s) => s.key === slot.source)
        const slotTrack = slotTracks[slotIndex]
        if (!source || !slotTrack || isAudioOnlySource(project, source)) return
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
        const fitScale = slot.fit === 'cover' ? Math.max(rw / aw, rh / ah) : Math.min(rw / aw, rh / ah)
        slotTrack.elements.push({
          id: createElementId(),
          type: 'video',
          startMs: element.startMs + span.fromMs,
          durationMs: span.toMs - span.fromMs,
          assetId: source.assetId,
          trimStartMs: source.offsetMs + element.trimStartMs + span.fromMs,
          ...flattenSlotMotion(project, { element, fromMs: span.fromMs, toMs: span.toMs, rect: slot.rect, fitScale, size: { width: aw, height: ah } }),
          opacity: 1,
          volume: 1,
          muted: true,
          ...(source.reframe ? { reframe: source.reframe } : {}),
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
              trimStartMs: audioSource.offsetMs + element.trimStartMs,
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
