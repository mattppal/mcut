import { getElementType } from './element-registry'
import type { Project, TimelineElement } from './model'

/**
 * The exact (asset, source-time) pairs an element needs to paint at a given
 * timeline time. THE seam between render and decode: the compositor's
 * renderers, the export frame source, and the preview pool all enumerate
 * through this so a frame prepared by one is the frame requested by the
 * others (cache keys must match to the millisecond). Declared per element
 * type via its registry entry.
 */
export interface FrameRequest {
  assetId: string
  /** Source media time in ms, clamped ≥ 0 (matches renderer clamping). */
  sourceTimeMs: number
}

export function getFrameRequests(
  project: Project,
  element: TimelineElement,
  timelineMs: number,
): FrameRequest[] {
  return (
    getElementType(element.type)?.frameRequests?.(
      project,
      element as Record<string, unknown>,
      timelineMs,
    ) ?? []
  )
}
