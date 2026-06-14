import { CommandError } from './errors'
import { getElementType } from './element-registry'
import { splitKeyframes, type AnimatableProperty, type Keyframe, type KeyframeMap } from './keyframes'
import {
  MIN_ELEMENT_DURATION_MS,
  type MulticamElement,
  type Project,
  type TimelineElement,
} from './model'
import { getSourceSpanMs, type TimeMap } from './speed'

/**
 * Edge trims: move one boundary of a clip while its content stays anchored —
 * the shared core under roll, slide, and ripple-trim edits.
 *
 * `deltaMs` always moves the edge RIGHT (later) when positive. Shrinking an
 * edge reuses the SPLIT machinery (each element type's onSplit hook plus
 * splitKeyframes), so trims, timeMaps, reversed spans, angle lists, and word
 * timings get exactly the bookkeeping a split-and-discard would produce.
 * Growing an edge reveals more source where the type supports it.
 */
export type TrimEdge = 'start' | 'end'

const hasTimeMap = (element: TimelineElement): boolean =>
  'timeMap' in element && Array.isArray(element.timeMap) && element.timeMap.length >= 2

const isReversed = (element: TimelineElement): boolean =>
  'reversed' in element && element.reversed === true

/**
 * Move one edge of an element by `deltaMs`, keeping its content anchored.
 * Pure on the element; the caller re-validates (asset bounds) and re-places
 * (overlaps). Throws CommandError on minimum-duration violations, negative
 * trims, and unsupported combinations (growing the head of a reversed
 * speed-ramped clip).
 */
export function applyEdgeTrim(
  element: TimelineElement,
  edge: TrimEdge,
  deltaMs: number,
): TimelineElement {
  if (deltaMs === 0) return element
  const newDurationMs = edge === 'end' ? element.durationMs + deltaMs : element.durationMs - deltaMs
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

/**
 * Shrink by splitting at `offsetMs` and keeping one half (under the
 * element's own id). Runs splitKeyframes and the type's onSplit hook, so
 * every registered type's source bookkeeping applies — without the split
 * command's both-halves minimum-duration requirement.
 */
function shrinkViaSplit(
  element: TimelineElement,
  keep: 'left' | 'right',
  offsetMs: number,
): TimelineElement {
  const left: TimelineElement = { ...element, durationMs: offsetMs }
  const right: TimelineElement = {
    ...element,
    startMs: element.startMs + offsetMs,
    durationMs: element.durationMs - offsetMs,
  }
  if ('keyframes' in element && element.keyframes) {
    const split = splitKeyframes(element.keyframes, offsetMs)
    if (split.left) left.keyframes = split.left
    else delete left.keyframes
    if (split.right) right.keyframes = split.right
    else delete right.keyframes
  }
  getElementType(element.type)?.onSplit?.({
    element: element as Record<string, unknown>,
    left: left as Record<string, unknown>,
    right: right as Record<string, unknown>,
    offsetMs,
  })
  // The element's end-cut transition stays on it either way: the kept half
  // owns the (possibly moved) end cut, and render-time adjacency checks make
  // it inert unless a neighbor still abuts.
  return keep === 'left' ? left : right
}

/** Extend the end: later output, same in-point. */
function growEnd(element: TimelineElement, growMs: number): TimelineElement {
  const next: TimelineElement = { ...element, durationMs: element.durationMs + growMs }
  // With a timeMap the map clamps at its last keyframe (freeze tail), and a
  // reversed map freezes on the span's first frame — no bookkeeping needed.
  if (hasTimeMap(element)) return next
  if (isReversed(element) && 'trimStartMs' in next) {
    // Reversed clips play the span backward: a later out point reveals
    // EARLIER source, so the window slides down.
    next.trimStartMs = next.trimStartMs - growMs
    if (next.trimStartMs < 0) {
      throw new CommandError('out-of-bounds', `"${element.id}" has no media before its trim start`)
    }
  }
  return next
}

/** Extend the start: earlier output, revealing earlier (or later, reversed) source. */
function growStart(element: TimelineElement, growMs: number): TimelineElement {
  const next: TimelineElement = {
    ...element,
    startMs: element.startMs - growMs,
    durationMs: element.durationMs + growMs,
  }
  // Keyframes are element-local: existing motion shifts later to stay anchored.
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
    // Cuts shift with their content; the first layout extends over the new head.
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
    // Reversed: the head shows the END of the span, so growing it reveals
    // LATER source. The span (== durationMs) already grew; the trim stays.
    // Asset-bound validation catches overruns.
    return next
  }

  const trimStartMs = next.trimStartMs - growMs
  if (trimStartMs < 0) {
    throw new CommandError('out-of-bounds', `"${element.id}" has no media before its trim start`)
  }
  next.trimStartMs = trimStartMs
  if (hasTimeMap(next) && next.timeMap) {
    // Map values are source offsets relative to trimStartMs: rebase onto the
    // earlier trim and cover the new head with a 1x segment.
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
  /** Most negative accepted `deltaMs` (edge moving left). */
  minDeltaMs: number
  /** Most positive accepted `deltaMs` (edge moving right). */
  maxDeltaMs: number
}

/**
 * The `deltaMs` range {@link applyEdgeTrim} accepts for this element and
 * edge, from minimum duration, timeline zero, and available media. UIs clamp
 * drags with this; ±Infinity where media is unbounded (stills, freezes,
 * unknown asset durations).
 */
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
        growLimitMs = Infinity // freeze tail
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
        ? 0 // unsupported combination
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
