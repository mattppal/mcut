import { z } from 'zod'
import { interpolateTrack, keyframeSchema, upsertKeyframe, type Keyframe } from './keyframes'

/**
 * Time remapping (clip speed) as a keyframe curve, not a scalar rate.
 *
 * A `timeMap` maps element-local OUTPUT time (ms since the clip's start on
 * the timeline) to a SOURCE offset (ms relative to `trimStartMs`). Constant
 * speed is the degenerate two-keyframe linear map; bezier easing between
 * keyframes is a speed ramp; a flat segment is a freeze-frame. Absent map =
 * 1x. Values must be monotone non-decreasing (no reverse playback — a
 * deliberate v1 constraint, matching GES's invariants).
 *
 * Every mature NLE converged on this representation (libopenshot's `time`
 * keyframe, MLT's `timeremap` link, Blender's retiming keys); a scalar
 * `playbackRate` cannot express ramps and gets migrated away eventually.
 */
export const timeMapSchema = z
  .array(keyframeSchema)
  .min(2)
  .refine(
    (frames) => frames.every((k, i) => i === 0 || k.timeMs > frames[i - 1]!.timeMs),
    'timeMap keyframes must be strictly increasing in time',
  )
  .refine(
    (frames) => frames.every((k) => k.value >= 0),
    'timeMap values are source offsets and must be >= 0',
  )
  .refine(
    (frames) => frames.every((k, i) => i === 0 || k.value >= frames[i - 1]!.value),
    'timeMap values must be non-decreasing (reverse playback is not supported)',
  )

export type TimeMap = z.infer<typeof timeMapSchema>

/** Structural slice of video/audio elements that the mapping helpers need. */
export interface TimeMappedElement {
  startMs: number
  durationMs: number
  trimStartMs: number
  timeMap?: TimeMap | undefined
  reversed?: boolean | undefined
}

const hasTimeMap = (element: { timeMap?: TimeMap | undefined }): element is { timeMap: TimeMap } =>
  Array.isArray(element.timeMap) && element.timeMap.length >= 2

/**
 * Source media time (ms) that plays at element-local output time `localMs`.
 * THE seam between timeline and media: compositor, export, preview pool, and
 * filmstrips must all use this so preview and export agree frame-for-frame.
 *
 * `reversed` plays the same source span backward: it post-transforms the
 * mapped offset (span − offset), so the timeMap keeps its monotone invariant
 * and ramps compose with reversal instead of fighting it.
 */
export function getSourceTimeMs(element: TimeMappedElement, localMs: number): number {
  const mapped = hasTimeMap(element) ? interpolateTrack(element.timeMap, localMs) : localMs
  if (element.reversed) {
    return element.trimStartMs + Math.max(0, getSourceSpanMs(element) - mapped)
  }
  return element.trimStartMs + mapped
}

/**
 * Source duration (ms) the element consumes. Without a timeMap this equals
 * `durationMs`; with one it is the last keyframe's value (maps are monotone).
 */
export function getSourceSpanMs(element: { durationMs: number; timeMap?: TimeMap | undefined }): number {
  if (!hasTimeMap(element)) return element.durationMs
  return element.timeMap[element.timeMap.length - 1]!.value
}

/**
 * Average speed multiplier (source span / output duration). 1 when unmapped.
 */
export function getAverageSpeed(element: { durationMs: number; timeMap?: TimeMap | undefined }): number {
  if (!hasTimeMap(element)) return 1
  return getSourceSpanMs(element) / Math.max(1, element.durationMs)
}

/**
 * Instantaneous speed (d source / d output) at element-local `localMs`,
 * via central finite difference — robust for any easing. 0 inside a freeze.
 */
export function getSpeedAt(element: TimeMappedElement, localMs: number, windowMs = 8): number {
  if (!hasTimeMap(element)) return 1
  const lo = Math.max(0, localMs - windowMs)
  const hi = Math.min(element.durationMs, localMs + windowMs)
  if (hi <= lo) return getAverageSpeed(element)
  const span = interpolateTrack(element.timeMap, hi) - interpolateTrack(element.timeMap, lo)
  return Math.max(0, span / (hi - lo))
}

/** A constant-speed map for a clip of output duration `durationMs`. */
export function makeConstantSpeedMap(durationMs: number, speed: number): TimeMap {
  return [
    { timeMs: 0, value: 0 },
    { timeMs: durationMs, value: Math.round(durationMs * speed) },
  ]
}

/**
 * Split a timeMap at element-local `offsetMs` into maps for the two halves
 * of a split clip. Both halves get an evaluated boundary keyframe so motion
 * through the cut stays continuous; the right half's map is rebased so its
 * values stay relative to the ORIGINAL `trimStartMs` (split does not change
 * `trimStartMs` on time-mapped clips — the map carries the offset).
 */
export function splitTimeMap(timeMap: TimeMap, offsetMs: number): { left: TimeMap; right: TimeMap } {
  const boundaryValue = interpolateTrack(timeMap, offsetMs)
  let segmentBefore: Keyframe | undefined
  for (const k of timeMap) {
    if (k.timeMs <= offsetMs) segmentBefore = k
    else break
  }
  const left = upsertKeyframe(
    timeMap.filter((k) => k.timeMs < offsetMs),
    { timeMs: offsetMs, value: boundaryValue },
  )
  const right = upsertKeyframe(
    timeMap.filter((k) => k.timeMs > offsetMs).map((k) => ({ ...k, timeMs: k.timeMs - offsetMs })),
    {
      timeMs: 0,
      value: boundaryValue,
      ...(segmentBefore?.easing !== undefined ? { easing: segmentBefore.easing } : {}),
    },
  )
  return {
    left: ensureMinKeyframes(left, offsetMs),
    right: ensureMinKeyframes(right, Number.MAX_SAFE_INTEGER),
  }
}

/** timeMapSchema requires >= 2 keyframes; degenerate halves get an end pin. */
function ensureMinKeyframes(track: Keyframe[], endMs: number): TimeMap {
  if (track.length >= 2) return track
  const only = track[0] ?? { timeMs: 0, value: 0 }
  const endTime = Math.min(endMs, only.timeMs + 1)
  const second =
    endTime > only.timeMs
      ? { timeMs: endTime, value: only.value }
      : { timeMs: only.timeMs + 1, value: only.value }
  return [only, second]
}
