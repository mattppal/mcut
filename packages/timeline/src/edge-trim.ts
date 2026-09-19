import { CommandError } from './errors'
import type { AnimatableProperty, Keyframe, KeyframeMap } from './keyframes'
import {
  MIN_ELEMENT_DURATION_MS,
  splitElementAt,
  type MulticamElement,
  type Project,
  type TimelineElement,
} from './model'
import { getSourceSpanMs, type TimeMap } from './speed'

export type TrimEdge = 'start' | 'end'

const hasTimeMap = (element: TimelineElement): boolean =>
  'timeMap' in element && Array.isArray(element.timeMap) && element.timeMap.length >= 2

const isReversed = (element: TimelineElement): boolean =>
  'reversed' in element && element.reversed === true

export function applyEdgeTrim(
  element: TimelineElement,
  edge: TrimEdge,
  deltaMs: number,
): TimelineElement {
  if (deltaMs === 0) return element
  const newDurationMs = edge === 'end' ? element.durationMs + deltaMs : element.durationMs - deltaMs
  if (!Number.isSafeInteger(newDurationMs)) {
    throw new CommandError(
      'out-of-bounds',
      `trimming "${element.id}" to ${newDurationMs}ms exceeds the safe integer range`,
    )
  }
  if (newDurationMs < MIN_ELEMENT_DURATION_MS) {
    throw new CommandError(
      'out-of-bounds',
      `trimming "${element.id}" leaves ${newDurationMs}ms; the minimum is ${MIN_ELEMENT_DURATION_MS}ms`,
    )
  }
  if (edge === 'start' && element.startMs + deltaMs < 0) {
    throw new CommandError('out-of-bounds', `trimming "${element.id}" would start before 0`)
  }

  if (edge === 'end') {
    return deltaMs < 0 ? shrinkViaSplit(element, 'left', newDurationMs) : growEnd(element, deltaMs)
  }
  return deltaMs > 0 ? shrinkViaSplit(element, 'right', deltaMs) : growStart(element, -deltaMs)
}

function shrinkViaSplit(
  element: TimelineElement,
  keep: 'left' | 'right',
  offsetMs: number,
): TimelineElement {
  const { left, right } = splitElementAt(element, offsetMs)
  return keep === 'left' ? left : right
}

function growEnd(element: TimelineElement, growMs: number): TimelineElement {
  const next: TimelineElement = { ...element, durationMs: element.durationMs + growMs }
  if (hasTimeMap(element)) return next
  if (isReversed(element) && 'trimStartMs' in next) {
    next.trimStartMs = next.trimStartMs - growMs
    if (next.trimStartMs < 0) {
      throw new CommandError('out-of-bounds', `"${element.id}" has no media before its trim start`)
    }
  }
  return next
}

function growStart(element: TimelineElement, growMs: number): TimelineElement {
  const next: TimelineElement = {
    ...element,
    startMs: element.startMs - growMs,
    durationMs: element.durationMs + growMs,
  }
  if ('keyframes' in next && next.keyframes) {
    const shifted: KeyframeMap = {}
    for (const [property, track] of Object.entries(next.keyframes) as Array<
      [AnimatableProperty, Keyframe[] | undefined]
    >) {
      if (!track) continue
      shifted[property] = track.map((k) => ({ ...k, timeMs: k.timeMs + growMs }))
    }
    next.keyframes = shifted
  }

  if (element.type === 'caption') {
    if ('words' in next && next.words) {
      next.words = next.words.map((w) => ({
        ...w,
        startMs: w.startMs + growMs,
        endMs: w.endMs + growMs,
      }))
    }
    return next
  }

  if (element.type === 'multicam') {
    const multicam = next as MulticamElement
    if (hasTimeMap(element)) {
      throw new CommandError(
        'unsupported',
        `cannot extend the start of speed-ramped multicam "${element.id}"`,
      )
    }
    multicam.sources = multicam.sources.map((source) => {
      const trimStartMs = source.trimStartMs - growMs
      if (trimStartMs < 0) {
        throw new CommandError(
          'out-of-bounds',
          `multicam source "${source.key}" has no media before its trim start`,
        )
      }
      return { ...source, trimStartMs }
    })
    const angles = multicam.angles.map((a) => ({ ...a, atMs: a.atMs + growMs }))
    if (angles[0]) angles[0] = { ...angles[0], atMs: 0 }
    multicam.angles = angles
    return multicam
  }

  if (!('trimStartMs' in next)) return next

  if (isReversed(element)) {
    if (hasTimeMap(element)) {
      throw new CommandError(
        'unsupported',
        `cannot extend the start of reversed speed-ramped clip "${element.id}"`,
      )
    }
    return next
  }

  const trimStartMs = next.trimStartMs - growMs
  if (trimStartMs < 0) {
    throw new CommandError('out-of-bounds', `"${element.id}" has no media before its trim start`)
  }
  next.trimStartMs = trimStartMs
  if (hasTimeMap(next) && next.timeMap) {
    const rebased = next.timeMap.map((k) => ({
      ...k,
      timeMs: k.timeMs + growMs,
      value: k.value + growMs,
    }))
    next.timeMap = [{ timeMs: 0, value: 0 }, ...rebased] as TimeMap
  }
  return next
}

export interface EdgeTrimRange {
  minDeltaMs: number
  maxDeltaMs: number
}

export function getEdgeTrimRange(
  project: Project,
  element: TimelineElement,
  edge: TrimEdge,
): EdgeTrimRange {
  const shrinkLimitMs = element.durationMs - MIN_ELEMENT_DURATION_MS
  const assetDurationMs =
    'assetId' in element ? project.assets[element.assetId]?.durationMs : undefined
  const trimStartMs = 'trimStartMs' in element ? element.trimStartMs : 0
  const mapped = hasTimeMap(element)
  const reversed = isReversed(element)

  if (edge === 'end') {
    let growLimitMs = Infinity
    if (element.type === 'video' || element.type === 'audio') {
      if (mapped) {
        growLimitMs = Infinity
      } else if (reversed) {
        growLimitMs = trimStartMs
      } else if (assetDurationMs !== undefined) {
        growLimitMs = assetDurationMs - trimStartMs - getSourceSpanMs(element)
      }
    } else if (element.type === 'multicam' && !mapped) {
      growLimitMs = Math.min(
        ...element.sources.map((source) => {
          const duration = project.assets[source.assetId]?.durationMs
          return duration === undefined
            ? Infinity
            : duration - source.trimStartMs - element.durationMs
        }),
      )
    }
    return { minDeltaMs: -shrinkLimitMs, maxDeltaMs: Math.max(0, growLimitMs) }
  }

  let growLimitMs = Infinity
  if (element.type === 'video' || element.type === 'audio') {
    if (reversed) {
      growLimitMs = mapped
        ? 0
        : assetDurationMs === undefined
          ? Infinity
          : assetDurationMs - trimStartMs - getSourceSpanMs(element)
    } else {
      growLimitMs = trimStartMs
    }
  } else if (element.type === 'multicam') {
    growLimitMs = mapped ? 0 : Math.min(...element.sources.map((source) => source.trimStartMs))
  }
  return {
    minDeltaMs: -Math.max(0, Math.min(growLimitMs, element.startMs)),
    maxDeltaMs: shrinkLimitMs,
  }
}
