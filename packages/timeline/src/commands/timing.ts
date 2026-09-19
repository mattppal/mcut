import { z } from 'zod'
import { applyEdgeTrim } from '../edge-trim'
import { CommandError } from '../errors'
import { elementIdSchema, MIN_ELEMENT_DURATION_MS, validateElement, type TimelineElement, type Track } from '../model'
import { compactTimelineIfMagnetic, placementFor } from '../placement'
import { getSourceSpanMs, makeConstantSpeedMap, timeMapSchema } from '../speed'
import { defineCommand, mustLocate, replaceTrack, sortByStart } from './shared'

function mustBeTimeMappable(element: TimelineElement): asserts element is TimelineElement & {
  type: 'video' | 'audio'
} {
  if (element.type !== 'video' && element.type !== 'audio') {
    throw new CommandError('invalid-payload', `"${element.type}" elements have no playback speed`)
  }
}

export const setElementSpeed = defineCommand({
  type: 'setElementSpeed',
  description:
    'Set a constant playback speed on a video/audio element (2 = twice as fast). ' +
    'The clip keeps its in-point; its timeline duration rescales to play the same ' +
    'source span. Replaces any existing speed ramp with a constant map; speed 1 ' +
    'removes the map. For ramps and freeze-frames use setTimeMap.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    speed: z.number().min(0.05).max(20),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    mustBeTimeMappable(element)
    const sourceSpanMs = getSourceSpanMs(element)
    const durationMs = Math.max(MIN_ELEMENT_DURATION_MS, Math.round(sourceSpanMs / payload.speed))
    const next: TimelineElement = { ...element, durationMs }
    if (Math.abs(payload.speed - 1) < 1e-9) delete next.timeMap
    else next.timeMap = makeConstantSpeedMap(durationMs, sourceSpanMs / durationMs)
    validateElement(project, next)
    const policy = placementFor(track)
    policy.assertCanPlace(track, next)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: policy.place(t, next),
    }))
  },
})

export const setTimeMap = defineCommand({
  type: 'setTimeMap',
  description:
    'Set or clear a time remap curve on a video/audio element: keyframes from ' +
    'element-local output ms to source ms (relative to trimStartMs), monotone ' +
    'non-decreasing. Bezier easing between keyframes = speed ramp; a flat ' +
    'segment = freeze-frame. Pass null to restore 1x.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    timeMap: timeMapSchema.nullable(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    mustBeTimeMappable(element)
    const next: TimelineElement = { ...element }
    if (payload.timeMap === null) delete next.timeMap
    else next.timeMap = payload.timeMap
    validateElement(project, next)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? next : e)),
    }))
  },
})

function adjacentNext(track: Track, element: TimelineElement): TimelineElement | undefined {
  const cutMs = element.startMs + element.durationMs
  return track.elements.find((e) => e.startMs === cutMs && e.id !== element.id)
}

function adjacentPrevious(track: Track, element: TimelineElement): TimelineElement | undefined {
  return track.elements.find((e) => e.startMs + e.durationMs === element.startMs && e.id !== element.id)
}

export const trimEdge = defineCommand({
  type: 'trimEdge',
  description:
    'Trim ONE edge of a clip while its content stays anchored: reversed ' +
    'spans, speed maps, keyframes, and caption words all keep showing the ' +
    'same frames. Positive deltaMs moves the edge later. The other edge and ' +
    'every other clip stay put. Prefer this over raw trimElement for edge ' +
    'drags — trimElement edits the source window directly and shifts a ' +
    "reversed clip's content.",
  payloadSchema: z.object({
    elementId: elementIdSchema,
    edge: z.enum(['start', 'end']),
    deltaMs: z.number().int(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (payload.deltaMs === 0) return project
    const next = applyEdgeTrim(element, payload.edge, payload.deltaMs)
    validateElement(project, next)
    const policy = placementFor(track)
    policy.assertCanPlace(track, next)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: policy.place(t, next),
    }))
  },
})

export const slipElement = defineCommand({
  type: 'slipElement',
  description:
    'Slip a clip: shift WHICH part of the source plays without moving the clip ' +
    'on the timeline. Positive deltaMs slides the source window later. Applies ' +
    'to video/audio (trim offset) and multicam (every source in sync).',
  payloadSchema: z.object({ elementId: elementIdSchema, deltaMs: z.number().int() }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (payload.deltaMs === 0) return project
    let next: TimelineElement
    if (element.type === 'video' || element.type === 'audio') {
      const trimStartMs = element.trimStartMs + payload.deltaMs
      if (trimStartMs < 0) {
        throw new CommandError('out-of-bounds', `"${element.id}" has no media before its trim start`)
      }
      next = { ...element, trimStartMs }
    } else if (element.type === 'multicam') {
      next = {
        ...element,
        sources: element.sources.map((source) => {
          const trimStartMs = source.trimStartMs + payload.deltaMs
          if (trimStartMs < 0) {
            throw new CommandError('out-of-bounds', `multicam source "${source.key}" has no media before its trim start`)
          }
          return { ...source, trimStartMs }
        }),
      }
    } else {
      throw new CommandError('invalid-payload', `"${element.type}" elements have no source to slip`)
    }
    validateElement(project, next)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? next : e)),
    }))
  },
})

export const rollEdit = defineCommand({
  type: 'rollEdit',
  description:
    'Roll the cut between a clip and its exactly-adjacent NEXT clip: the ' +
    'boundary moves by deltaMs, one clip revealing source while the other ' +
    'conceals it. Track length and every other clip stay put.',
  payloadSchema: z.object({ elementId: elementIdSchema, deltaMs: z.number().int() }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const right = adjacentNext(track, element)
    if (!right) {
      throw new CommandError('invalid-payload', `element "${element.id}" has no exactly-adjacent next clip to roll against`)
    }
    if (payload.deltaMs === 0) return project
    const newLeft = applyEdgeTrim(element, 'end', payload.deltaMs)
    const newRight = applyEdgeTrim(right, 'start', payload.deltaMs)
    validateElement(project, newLeft)
    validateElement(project, newRight)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: sortByStart(t.elements.map((e) => (e.id === element.id ? newLeft : e.id === right.id ? newRight : e))),
    }))
  },
})

export const slideElement = defineCommand({
  type: 'slideElement',
  description:
    'Slide a clip along its exactly-adjacent neighbors: the clip moves by ' +
    "deltaMs keeping its content; the left neighbor's end and the right " +
    "neighbor's start absorb the change. Use moveElement across gaps.",
  payloadSchema: z.object({ elementId: elementIdSchema, deltaMs: z.number().int() }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const left = adjacentPrevious(track, element)
    const right = adjacentNext(track, element)
    if (!left || !right) {
      throw new CommandError('invalid-payload', `slide requires exactly-adjacent clips on both sides of "${element.id}"`)
    }
    if (payload.deltaMs === 0) return project
    const newLeft = applyEdgeTrim(left, 'end', payload.deltaMs)
    const newRight = applyEdgeTrim(right, 'start', payload.deltaMs)
    const moved: TimelineElement = { ...element, startMs: element.startMs + payload.deltaMs }
    validateElement(project, newLeft)
    validateElement(project, newRight)
    validateElement(project, moved)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: sortByStart(t.elements.map((e) => (e.id === left.id ? newLeft : e.id === right.id ? newRight : e.id === element.id ? moved : e))),
    }))
  },
})

function trimStartKeepingPosition(element: TimelineElement, deltaMs: number): TimelineElement {
  const liftedClearOfTimelineZero = { ...element, startMs: element.startMs + Math.max(0, -deltaMs) }
  return { ...applyEdgeTrim(liftedClearOfTimelineZero, 'start', deltaMs), startMs: element.startMs }
}

export const rippleTrim = defineCommand({
  type: 'rippleTrim',
  description:
    'Trim a clip edge AND ripple: everything downstream of the edit shifts by ' +
    'the same amount, so no gap opens or closes unevenly. scope "timeline" ' +
    '(default) shifts every unlocked track; "track" only the clip\'s own track.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    edge: z.enum(['start', 'end']),
    deltaMs: z.number().int(),
    scope: z.enum(['track', 'timeline']).default('timeline'),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (payload.deltaMs === 0) return project
    const trimmed = payload.edge === 'start' ? trimStartKeepingPosition(element, payload.deltaMs) : applyEdgeTrim(element, 'end', payload.deltaMs)
    const shiftMs = payload.edge === 'end' ? payload.deltaMs : -payload.deltaMs
    const boundaryMs = payload.edge === 'end' ? element.startMs + element.durationMs : element.startMs
    validateElement(project, trimmed)

    const tracks = project.tracks.map((t) => {
      const affected = t.id === track.id || (payload.scope === 'timeline' && !t.locked)
      if (!affected) return t
      const elements = sortByStart(
        t.elements.map((e) => {
          if (e.id === element.id) return trimmed
          if (e.startMs < boundaryMs) return e
          const startMs = e.startMs + shiftMs
          if (startMs < 0) {
            throw new CommandError('out-of-bounds', `ripple would move "${e.id}" before the start of the timeline`)
          }
          return { ...e, startMs }
        }),
      )
      const next = { ...t, elements }
      placementFor(t).assertNoOverlaps(next)
      return next
    })
    return compactTimelineIfMagnetic({ ...project, tracks })
  },
})
