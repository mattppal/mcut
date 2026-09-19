import { collectSnapTargets as collectTimelineSnapTargets, type Project, type SnapTarget } from '@mcut/timeline'

export { snapClip, snapTime } from '@mcut/timeline'
export type { SnapClipResult, SnapOptions, SnapResult, SnapTarget } from '@mcut/timeline'

export function collectSnapTargets(project: Project, playheadMs: number, excludeElementIds: ReadonlySet<string> = new Set()): SnapTarget[] {
  return collectTimelineSnapTargets(project, { playheadMs, excludeElementIds })
}

export function pointerToTimelineMs(clientX: number, laneRect: { left: number }, pxPerMs: number): number {
  return Math.max(0, Math.round((clientX - laneRect.left) / pxPerMs))
}
