import { z } from 'zod'
import { interpolateTrack, keyframeSchema, upsertKeyframe, type Keyframe } from './keyframes'

export const timeMapSchema = z
  .array(keyframeSchema)
  .min(2)
  .refine((frames) => frames.every((k, i) => i === 0 || k.timeMs > frames[i - 1]!.timeMs), 'timeMap keyframes must be strictly increasing in time')
  .refine((frames) => frames.every((k) => k.value >= 0), 'timeMap values are source offsets and must be >= 0')
  .refine(
    (frames) => frames.every((k, i) => i === 0 || k.value >= frames[i - 1]!.value),
    'timeMap values must be non-decreasing (reverse playback is not supported)',
  )

export type TimeMap = z.infer<typeof timeMapSchema>

export interface TimeMappedElement {
  startMs: number
  durationMs: number
  trimStartMs: number
  timeMap?: TimeMap | undefined
  reversed?: boolean | undefined
}

const hasTimeMap = (element: { timeMap?: TimeMap | undefined }): element is { timeMap: TimeMap } =>
  Array.isArray(element.timeMap) && element.timeMap.length >= 2

export function getSourceTimeMs(element: TimeMappedElement, localMs: number): number {
  const mapped = hasTimeMap(element) ? interpolateTrack(element.timeMap, localMs) : localMs
  if (element.reversed) {
    return element.trimStartMs + Math.max(0, getSourceSpanMs(element) - mapped)
  }
  return element.trimStartMs + mapped
}

export function getLocalTimeMs(element: TimeMappedElement, sourceMs: number): number {
  const offsetMs = sourceMs - element.trimStartMs
  const mappedMs = element.reversed ? getSourceSpanMs(element) - offsetMs : offsetMs
  if (!hasTimeMap(element)) return Math.min(element.durationMs, Math.max(0, mappedMs))
  const { timeMap } = element
  let lo = 0
  let hi = element.durationMs
  if (interpolateTrack(timeMap, lo) >= mappedMs) return lo
  if (interpolateTrack(timeMap, hi) < mappedMs) return hi
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2
    if (interpolateTrack(timeMap, mid) >= mappedMs) hi = mid
    else lo = mid
  }
  return hi
}

export function getSourceSpanMs(element: { durationMs: number; timeMap?: TimeMap | undefined }): number {
  if (!hasTimeMap(element)) return element.durationMs
  return element.timeMap[element.timeMap.length - 1]!.value
}

export function getAverageSpeed(element: { durationMs: number; timeMap?: TimeMap | undefined }): number {
  if (!hasTimeMap(element)) return 1
  return getSourceSpanMs(element) / Math.max(1, element.durationMs)
}

export function getSpeedAt(element: TimeMappedElement, localMs: number, windowMs = 8): number {
  if (!hasTimeMap(element)) return 1
  const lo = Math.max(0, localMs - windowMs)
  const hi = Math.min(element.durationMs, localMs + windowMs)
  if (hi <= lo) return getAverageSpeed(element)
  const span = interpolateTrack(element.timeMap, hi) - interpolateTrack(element.timeMap, lo)
  return Math.max(0, span / (hi - lo))
}

export function makeConstantSpeedMap(durationMs: number, speed: number): TimeMap {
  return [
    { timeMs: 0, value: 0 },
    { timeMs: durationMs, value: Math.round(durationMs * speed) },
  ]
}

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

function ensureMinKeyframes(track: Keyframe[], endMs: number): TimeMap {
  if (track.length >= 2) return track
  const only = track[0] ?? { timeMs: 0, value: 0 }
  const endTime = Math.min(endMs, only.timeMs + 1)
  const second = endTime > only.timeMs ? { timeMs: endTime, value: only.value } : { timeMs: only.timeMs + 1, value: only.value }
  return [only, second]
}
