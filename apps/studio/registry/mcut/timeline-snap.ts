import {
  collectSnapTargets as collectTimelineSnapTargets,
  type Project,
  type SnapTarget,
} from "@mcut/timeline";

// The snap engine itself (targets, nearest-target search, frame fallback)
// lives in @mcut/timeline so every gesture and any host app agree on policy;
// this module keeps the app-shaped entry points.
export { snapClip, snapTime } from "@mcut/timeline";
export type { SnapClipResult, SnapOptions, SnapResult, SnapTarget } from "@mcut/timeline";

/**
 * Magnetic snap targets: timeline zero, the playhead, markers, and every
 * clip edge (except the elements being dragged). Sorted by time.
 */
export function collectSnapTargets(
  project: Project,
  playheadMs: number,
  excludeElementIds: ReadonlySet<string> = new Set(),
): SnapTarget[] {
  return collectTimelineSnapTargets(project, { playheadMs, excludeElementIds });
}

/** Convert a pointer clientX into timeline ms for a lane element. */
export function pointerToTimelineMs(
  clientX: number,
  laneRect: { left: number },
  pxPerMs: number,
): number {
  return Math.max(0, Math.round((clientX - laneRect.left) / pxPerMs));
}
