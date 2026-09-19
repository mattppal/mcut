import type { Project } from './model'
import { quantizeMsToFrame } from './time'

export type SnapTargetKind = 'origin' | 'clip-start' | 'clip-end' | 'marker' | 'playhead'

export interface SnapTarget {
  timeMs: number
  kind: SnapTargetKind
}

export interface SnapOptions {
  enabled?: boolean
  fps?: number
}

export interface SnapResult {
  ms: number
  guideMs: number | null
  target: SnapTarget | null
}

export interface SnapClipResult extends SnapResult {
  edge: 'start' | 'end' | null
}

export interface CollectSnapTargetsOptions {
  playheadMs?: number
  excludeElementIds?: ReadonlySet<string>
}

export function collectSnapTargets(project: Project, options: CollectSnapTargetsOptions = {}): SnapTarget[] {
  const exclude = options.excludeElementIds
  const targets: SnapTarget[] = [{ timeMs: 0, kind: 'origin' }]
  if (options.playheadMs !== undefined) {
    targets.push({ timeMs: Math.round(options.playheadMs), kind: 'playhead' })
  }
  for (const marker of project.markers) {
    targets.push({ timeMs: marker.timeMs, kind: 'marker' })
  }
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if (exclude?.has(element.id)) continue
      targets.push({ timeMs: element.startMs, kind: 'clip-start' })
      targets.push({ timeMs: element.startMs + element.durationMs, kind: 'clip-end' })
    }
  }
  return targets.sort((a, b) => a.timeMs - b.timeMs)
}

export function nearestSnapTarget(timeMs: number, targets: readonly SnapTarget[], thresholdMs: number): SnapTarget | null {
  if (targets.length === 0 || thresholdMs <= 0) return null
  let lo = 0
  let hi = targets.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (targets[mid]!.timeMs < timeMs) lo = mid + 1
    else hi = mid
  }
  const before = targets[lo - 1]
  const after = targets[lo]
  const beforeDistance = before ? Math.abs(timeMs - before.timeMs) : Infinity
  const afterDistance = after ? Math.abs(after.timeMs - timeMs) : Infinity
  const best = beforeDistance <= afterDistance ? before : after
  const bestDistance = Math.min(beforeDistance, afterDistance)
  return best && bestDistance <= thresholdMs ? best : null
}

const passthrough = (ms: number, fps: number | undefined): SnapResult => ({
  ms: fps !== undefined ? quantizeMsToFrame(ms, fps) : ms,
  guideMs: null,
  target: null,
})

export function snapTime(candidateMs: number, targets: readonly SnapTarget[], thresholdMs: number, options: SnapOptions = {}): SnapResult {
  if (options.enabled === false) return passthrough(candidateMs, options.fps)
  const target = nearestSnapTarget(candidateMs, targets, thresholdMs)
  if (!target) return passthrough(candidateMs, options.fps)
  return { ms: target.timeMs, guideMs: target.timeMs, target }
}

export function snapClip(startMs: number, durationMs: number, targets: readonly SnapTarget[], thresholdMs: number, options: SnapOptions = {}): SnapClipResult {
  if (options.enabled === false) return { ...passthrough(startMs, options.fps), edge: null }
  const startTarget = nearestSnapTarget(startMs, targets, thresholdMs)
  const endTarget = nearestSnapTarget(startMs + durationMs, targets, thresholdMs)
  const startDistance = startTarget ? Math.abs(startTarget.timeMs - startMs) : Infinity
  const endDistance = endTarget ? Math.abs(endTarget.timeMs - (startMs + durationMs)) : Infinity
  if (startTarget && startDistance <= endDistance) {
    return { ms: startTarget.timeMs, guideMs: startTarget.timeMs, target: startTarget, edge: 'start' }
  }
  if (endTarget) {
    return { ms: endTarget.timeMs - durationMs, guideMs: endTarget.timeMs, target: endTarget, edge: 'end' }
  }
  return { ...passthrough(startMs, options.fps), edge: null }
}
