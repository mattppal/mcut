import { z } from 'zod'
import { applyEdgeTrim } from '../edge-trim'
import { CommandError } from '../errors'
import { createElementId, type ElementId, type TrackId } from '../id'
import { isMediaClip } from '../media-clip'
import {
  elementIdSchema,
  elementInputSchema,
  elementSchema,
  MIN_ELEMENT_DURATION_MS,
  splitElementAt,
  trackIdSchema,
  validateElement,
  type Project,
  type TimelineElement,
} from '../model'
import { compactTimelineIfMagnetic, placementFor, rangesOverlap } from '../placement'
import { listZoomRegions, renameSplitCopies } from '../zoom-regions'
import { defineCommand, insertSorted, mintElementId, mustGetTrack, mustLocate, replaceTrack, sortByStart } from './shared'

const editModeSchema = z.enum(['normal', 'overwrite', 'insert']).default('normal')

function mintRightPiece(project: Project, piece: TimelineElement, id: ElementId): TimelineElement {
  const minted = { ...piece, id }
  if ('zooms' in minted && minted.zooms) minted.zooms = renameSplitCopies(minted.zooms, new Set(listZoomRegions(project).map((z) => z.id)))
  return minted
}

function carveOverwriteRange(project: Project, trackId: TrackId, startMs: number, durationMs: number): Project {
  const endMs = startMs + durationMs
  return replaceTrack(project, trackId, (track) => {
    const elements: TimelineElement[] = []
    for (const element of track.elements) {
      if (!rangesOverlap(startMs, durationMs, element.startMs, element.durationMs)) {
        elements.push(element)
        continue
      }
      const elementEndMs = element.startMs + element.durationMs
      const headMs = startMs - element.startMs
      const tailMs = elementEndMs - endMs
      if (headMs >= MIN_ELEMENT_DURATION_MS) {
        const left = applyEdgeTrim(element, 'end', startMs - elementEndMs)
        if ('transition' in left) delete left.transition
        elements.push(left)
      }
      if (tailMs >= MIN_ELEMENT_DURATION_MS) {
        const right = applyEdgeTrim(element, 'start', endMs - element.startMs)
        elements.push(headMs >= MIN_ELEMENT_DURATION_MS ? mintRightPiece(project, right, createElementId()) : right)
      }
    }
    return { ...track, elements: sortByStart(elements) }
  })
}

function rippleOpenGap(project: Project, targetTrackId: TrackId, atMs: number, durationMs: number): Project {
  const tracks = project.tracks.map((track) => {
    const isTarget = track.id === targetTrackId
    if (track.locked && !isTarget) return track
    const elements: TimelineElement[] = []
    for (const element of track.elements) {
      const elementEndMs = element.startMs + element.durationMs
      if (element.startMs >= atMs) {
        elements.push({ ...element, startMs: element.startMs + durationMs })
        continue
      }
      if (isTarget && elementEndMs > atMs) {
        const headMs = atMs - element.startMs
        const tailMs = elementEndMs - atMs
        if (headMs < MIN_ELEMENT_DURATION_MS) {
          elements.push({ ...element, startMs: element.startMs + durationMs })
        } else if (tailMs < MIN_ELEMENT_DURATION_MS) {
          elements.push(applyEdgeTrim(element, 'end', atMs - elementEndMs))
        } else {
          const left = applyEdgeTrim(element, 'end', atMs - elementEndMs)
          if ('transition' in left) delete left.transition
          const right = applyEdgeTrim(element, 'start', headMs)
          elements.push(left, mintRightPiece(project, { ...right, startMs: atMs + durationMs }, createElementId()))
        }
        continue
      }
      elements.push(element)
    }
    return { ...track, elements: sortByStart(elements) }
  })
  return { ...project, tracks }
}

function placeElement(project: Project, trackId: TrackId, element: TimelineElement, editMode: z.output<typeof editModeSchema>): Project {
  const policy = placementFor(mustGetTrack(project, trackId))
  const mode = policy.editMode(editMode)
  let next = project
  if (mode === 'overwrite') {
    next = carveOverwriteRange(next, trackId, element.startMs, element.durationMs)
  } else if (mode === 'insert') {
    next = rippleOpenGap(next, trackId, element.startMs, element.durationMs)
  }
  policy.assertCanPlace(mustGetTrack(next, trackId), element)
  return replaceTrack(next, trackId, (t) => ({
    ...t,
    elements: policy.place(t, element),
  }))
}

export const addElement = defineCommand({
  type: 'addElement',
  description:
    'Add an element to a track. Elements on a track may not overlap in time. ' +
    'editMode "normal" (default) rejects collisions; "overwrite" clears the ' +
    'landing range; "insert" splits at the point and ripples everything after ' +
    'it right on every unlocked track. Omit `element.id` to have one generated.',
  payloadSchema: z.object({
    trackId: trackIdSchema,
    element: elementInputSchema,
    editMode: editModeSchema,
  }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    const element = { ...payload.element, id: mintElementId(project, payload.element.id) }
    validateElement(project, element)
    return placeElement(project, payload.trackId, element, payload.editMode)
  },
})

export const removeElement = defineCommand({
  type: 'removeElement',
  description: 'Remove an element from the timeline.',
  payloadSchema: z.object({ elementId: elementIdSchema }),
  reduce: (project, payload) => {
    const { track } = mustLocate(project, payload.elementId)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: placementFor(t).remove(t, payload.elementId),
    }))
  },
})

export const moveElement = defineCommand({
  type: 'moveElement',
  description:
    'Move an element in time and optionally to another track. editMode ' +
    '"normal" (default) rejects collisions; "overwrite" clears the landing ' +
    'range; "insert" ripples clips after the landing point right.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    startMs: z.number().int().nonnegative(),
    toTrackId: trackIdSchema.optional(),
    editMode: editModeSchema,
  }),
  reduce: (project, payload) => {
    const { track: fromTrack, element } = mustLocate(project, payload.elementId)
    const targetTrackId = payload.toTrackId ?? fromTrack.id
    mustGetTrack(project, targetTrackId)
    const moved: TimelineElement = { ...element, startMs: payload.startMs }
    const removed = replaceTrack(project, fromTrack.id, (t) => ({
      ...t,
      elements: placementFor(t).remove(t, element.id),
    }))
    return placeElement(removed, targetTrackId, moved, payload.editMode)
  },
})

export const trimElement = defineCommand({
  type: 'trimElement',
  description:
    'Set element timing. `startMs`/`durationMs` position it on the timeline; ' +
    '`trimStartMs` (video, audio, and multicam) offsets into the source media, the synced group clock for a multicam.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    startMs: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().min(MIN_ELEMENT_DURATION_MS).optional(),
    trimStartMs: z.number().int().nonnegative().optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const trimmed: TimelineElement = {
      ...element,
      startMs: payload.startMs ?? element.startMs,
      durationMs: payload.durationMs ?? element.durationMs,
    }
    if (payload.trimStartMs !== undefined) {
      if (!isMediaClip(trimmed)) {
        throw new CommandError('invalid-payload', 'trimStartMs only applies to video, audio, and multicam elements')
      }
      trimmed.trimStartMs = payload.trimStartMs
    }
    validateElement(project, trimmed)
    const policy = placementFor(track)
    policy.assertCanPlace(track, trimmed)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: policy.place(t, trimmed),
    }))
  },
})

export const splitElement = defineCommand({
  type: 'splitElement',
  description: 'Split an element at an absolute timeline time into two elements.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().positive(),
    rightElementId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const offset = payload.atMs - element.startMs
    if (offset < MIN_ELEMENT_DURATION_MS || element.durationMs - offset < MIN_ELEMENT_DURATION_MS) {
      throw new CommandError(
        'out-of-bounds',
        `cannot split "${element.id}" at ${payload.atMs}ms: both halves must be at least ` + `${MIN_ELEMENT_DURATION_MS}ms long`,
      )
    }
    const { left, right: rightHalf } = splitElementAt(element, offset)
    const right = mintRightPiece(project, rightHalf, mintElementId(project, payload.rightElementId))
    if ('transition' in left) delete left.transition
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: insertSorted(
        insertSorted(
          t.elements.filter((e) => e.id !== element.id),
          left,
        ),
        right,
      ),
    }))
  },
})

export const updateElement = defineCommand({
  type: 'updateElement',
  description:
    'Patch element properties (text, style, transform, opacity, volume, ...). ' + 'The merged element is re-validated; `id` and `type` cannot change.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    patch: z.record(z.string(), z.unknown()),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if ('id' in payload.patch || 'type' in payload.patch) {
      throw new CommandError('invalid-payload', 'patch may not change "id" or "type"')
    }
    const merged = elementSchema.safeParse({ ...element, ...payload.patch })
    if (!merged.success) {
      throw new CommandError('invalid-payload', `patch produces an invalid element: ${merged.error.message}`, { cause: merged.error })
    }
    validateElement(project, merged.data)
    const policy = placementFor(track)
    policy.assertCanPlace(track, merged.data)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: policy.place(t, merged.data),
    }))
  },
})

export const rippleDelete = defineCommand({
  type: 'rippleDelete',
  description:
    'Remove elements AND close the gaps they leave: later clips on the same ' +
    'track shift left by the removed duration (Premiere ripple delete). ' +
    'Other tracks are not affected.',
  payloadSchema: z.object({ elementIds: z.array(elementIdSchema).min(1) }),
  reduce: (project, payload) => {
    const ids = new Set<ElementId>(payload.elementIds)
    for (const id of payload.elementIds) mustLocate(project, id)
    const tracks = project.tracks.map((track) => {
      const removed = track.elements.filter((e) => ids.has(e.id))
      if (removed.length === 0) return track
      const elements = track.elements
        .filter((e) => !ids.has(e.id))
        .map((element) => {
          const shiftMs = removed.filter((r) => r.startMs < element.startMs).reduce((sum, r) => sum + r.durationMs, 0)
          return shiftMs > 0 ? { ...element, startMs: element.startMs - shiftMs } : element
        })
      return { ...track, elements }
    })
    return compactTimelineIfMagnetic({ ...project, tracks })
  },
})
