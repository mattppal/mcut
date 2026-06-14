import type { Project } from './model'
import { quantizeMsToFrame } from './time'

/**
 * Magnetic snapping for editing gestures (clip drag, trim, drop previews).
 *
 * Policy lives here so every gesture agrees on what attracts: clip edges,
 * markers, the playhead, and timeline zero. Commands stay snapping-free —
 * gestures snap, then dispatch (the OTIO data/policy boundary). Tolerance is
 * the caller's concern: UIs convert a pixel radius through their zoom
 * (`thresholdMs = SNAP_PX / pxPerMs`).
 *
 * Frame quantization is independent of magnetic snapping: pass `fps` and
 * times that no target grabs still land on frame boundaries (the time.ts
 * editing-surface contract). Disabling snapping disables the magnets, not
 * frame accuracy.
 */
export type SnapTargetKind = 'origin' | 'clip-start' | 'clip-end' | 'marker' | 'playhead'

export interface SnapTarget {
  timeMs: number
  kind: SnapTargetKind
}

export interface SnapOptions {
  /** Magnetic targets attract (default true). Off = frame quantization only. */
  enabled?: boolean
  /** When set, un-snapped times quantize to this frame grid. */
  fps?: number
}

export interface SnapResult {
  /** Snapped (or passed-through/quantized) time. */
  ms: number
  /** Where to render a guide line, if a magnetic target grabbed the value. */
  guideMs: number | null
  /** The target that grabbed the value (kind drives guide styling). */
  target: SnapTarget | null
}

export interface SnapClipResult extends SnapResult {
  /** Which clip edge landed on the target. */
  edge: 'start' | 'end' | null
}

export interface CollectSnapTargetsOptions {
  /** Include the playhead as a target. */
  playheadMs?: number
  /** Elements whose edges should not attract (the dragged clips). */
  excludeElementIds?: ReadonlySet<string>
}

/**
 * Every magnetic target in the project, sorted by time: timeline zero,
 * markers, clip edges, and optionally the playhead.
 */
export function collectSnapTargets(
  project: Project,
  options: CollectSnapTargetsOptions = {},
): SnapTarget[] {
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

/** Nearest target to `timeMs` within `thresholdMs` (ties: the earlier one). */
export function nearestSnapTarget(
  timeMs: number,
  targets: readonly SnapTarget[],
  thresholdMs: number,
): SnapTarget | null {
  if (targets.length === 0 || thresholdMs <= 0) return null
  // Binary search for the insertion point in the sorted target list.
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

/** Snap a single time to the nearest target within `thresholdMs`. */
export function snapTime(
  candidateMs: number,
  targets: readonly SnapTarget[],
  thresholdMs: number,
  options: SnapOptions = {},
): SnapResult {
  if (options.enabled === false) return passthrough(candidateMs, options.fps)
  const target = nearestSnapTarget(candidateMs, targets, thresholdMs)
  if (!target) return passthrough(candidateMs, options.fps)
  return { ms: target.timeMs, guideMs: target.timeMs, target }
}

/**
 * Snap a clip by either edge: whichever of start/end is closest to a target
 * wins, and the clip shifts so that edge lands exactly on it.
 */
export function snapClip(
  startMs: number,
  durationMs: number,
  targets: readonly SnapTarget[],
  thresholdMs: number,
  options: SnapOptions = {},
): SnapClipResult {
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
