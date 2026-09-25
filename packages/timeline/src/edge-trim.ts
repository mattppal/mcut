import { CommandError } from './errors'
import type { AnimatableProperty, Keyframe, KeyframeMap } from './keyframes'
import { getMediaSourceDurationMs, isMediaClip, type MediaClip } from './media-clip'
import { MIN_ELEMENT_DURATION_MS, splitElementAt, type Project, type TimelineElement } from './model'
import { getSourceSpanMs, hasTimeMap } from './speed'
import { shiftZoomRegions } from './zoom-regions'

export type TrimEdge = 'start' | 'end'

export function applyEdgeTrim(element: TimelineElement, edge: TrimEdge, deltaMs: number): TimelineElement {
  if (deltaMs === 0) return element
  const newDurationMs = edge === 'end' ? element.durationMs + deltaMs : element.durationMs - deltaMs
  if (!Number.isSafeInteger(newDurationMs)) {
    throw new CommandError('out-of-bounds', `trimming "${element.id}" to ${newDurationMs}ms exceeds the safe integer range`)
  }
  if (newDurationMs < MIN_ELEMENT_DURATION_MS) {
    throw new CommandError('out-of-bounds', `trimming "${element.id}" leaves ${newDurationMs}ms; the minimum is ${MIN_ELEMENT_DURATION_MS}ms`)
  }
  if (edge === 'start' && element.startMs + deltaMs < 0) {
    throw new CommandError('out-of-bounds', `trimming "${element.id}" would start before 0`)
  }

  if (edge === 'end') {
    return deltaMs < 0 ? shrinkViaSplit(element, 'left', newDurationMs) : growEnd(element, deltaMs)
  }
  return deltaMs > 0 ? shrinkViaSplit(element, 'right', deltaMs) : growStart(element, -deltaMs)
}

function shrinkViaSplit(element: TimelineElement, keep: 'left' | 'right', offsetMs: number): TimelineElement {
  const { left, right } = splitElementAt(element, offsetMs)
  return keep === 'left' ? left : right
}

function growEnd(element: TimelineElement, growMs: number): TimelineElement {
  const next: TimelineElement = { ...element, durationMs: element.durationMs + growMs }
  if (!isMediaClip(next) || hasTimeMap(next) || !next.reversed) return next
  next.trimStartMs = next.trimStartMs - growMs
  if (next.trimStartMs < 0) {
    throw new CommandError('out-of-bounds', `"${element.id}" has no media before its trim start`)
  }
  return next
}

function growStart(element: TimelineElement, growMs: number): TimelineElement {
  const next: TimelineElement = {
    ...element,
    startMs: element.startMs - growMs,
    durationMs: element.durationMs + growMs,
  }
  if (next.keyframes) {
    const shifted: KeyframeMap = {}
    for (const [property, track] of Object.entries(next.keyframes) as Array<[AnimatableProperty, Keyframe[] | undefined]>) {
      if (!track) continue
      shifted[property] = track.map((k) => ({ ...k, timeMs: k.timeMs + growMs }))
    }
    next.keyframes = shifted
  }
  if ('zooms' in next && next.zooms) next.zooms = shiftZoomRegions(next.zooms, growMs)

  if (next.type === 'caption') {
    if (next.words) {
      next.words = next.words.map((w) => ({
        ...w,
        startMs: w.startMs + growMs,
        endMs: w.endMs + growMs,
      }))
    }
    return next
  }

  if (!isMediaClip(next)) return next
  return revealBeforeWindow(next, growMs)
}

function revealBeforeWindow(clip: MediaClip, growMs: number): MediaClip {
  if (clip.reversed) {
    if (hasTimeMap(clip)) {
      throw new CommandError('unsupported', `cannot extend the start of reversed speed-ramped clip "${clip.id}"`)
    }
    return clip
  }
  const trimStartMs = clip.trimStartMs - growMs
  if (trimStartMs < 0) {
    throw new CommandError('out-of-bounds', `"${clip.id}" has no media before its trim start`)
  }
  clip.trimStartMs = trimStartMs
  if (clip.timeMap) {
    const rebased = clip.timeMap.map((k) => ({ ...k, timeMs: k.timeMs + growMs, value: k.value + growMs }))
    clip.timeMap = [{ timeMs: 0, value: 0 }, ...rebased]
  }
  return clip
}

export interface EdgeTrimRange {
  minDeltaMs: number
  maxDeltaMs: number
}

function remainingAfterWindowMs(project: Project, clip: MediaClip): number {
  const sourceDurationMs = getMediaSourceDurationMs(project, clip)
  return sourceDurationMs === undefined ? Infinity : sourceDurationMs - clip.trimStartMs - getSourceSpanMs(clip)
}

function endGrowLimitMs(project: Project, clip: MediaClip): number {
  if (hasTimeMap(clip)) return Infinity
  return clip.reversed ? clip.trimStartMs : remainingAfterWindowMs(project, clip)
}

function startGrowLimitMs(project: Project, clip: MediaClip): number {
  if (!clip.reversed) return clip.trimStartMs
  return hasTimeMap(clip) ? 0 : remainingAfterWindowMs(project, clip)
}

export function getEdgeTrimRange(project: Project, element: TimelineElement, edge: TrimEdge): EdgeTrimRange {
  const shrinkLimitMs = element.durationMs - MIN_ELEMENT_DURATION_MS
  if (edge === 'end') {
    const growLimitMs = isMediaClip(element) ? endGrowLimitMs(project, element) : Infinity
    return { minDeltaMs: -shrinkLimitMs, maxDeltaMs: Math.max(0, growLimitMs) }
  }
  const growLimitMs = isMediaClip(element) ? startGrowLimitMs(project, element) : Infinity
  return {
    minDeltaMs: -Math.max(0, Math.min(growLimitMs, element.startMs)),
    maxDeltaMs: shrinkLimitMs,
  }
}
