import { ZOOM_REGION_PRESETS, zoomRegionEndMs, type CommandOfType, type ZoomableElement, type ZoomRegion } from '@mcut/timeline'

export type ZoomRegionDragMode = 'move' | 'start' | 'in' | 'out' | 'end'

interface FreeSpan {
  startMs: number
  endMs: number
}

interface ZoomDragRule {
  range: (zoom: ZoomRegion, free: FreeSpan) => readonly [number, number]
  apply: (zoom: ZoomRegion, shiftMs: number) => ZoomRegion
}

const ZOOM_DRAG_RULES: Record<ZoomRegionDragMode, ZoomDragRule> = {
  move: {
    range: (zoom, free) => [free.startMs - zoom.atMs, free.endMs - zoomRegionEndMs(zoom)],
    apply: (zoom, shiftMs) => ({ ...zoom, atMs: zoom.atMs + shiftMs }),
  },
  start: {
    range: (zoom, free) => [free.startMs - zoom.atMs, zoom.holdMs],
    apply: (zoom, shiftMs) => ({ ...zoom, atMs: zoom.atMs + shiftMs, holdMs: zoom.holdMs - shiftMs }),
  },
  in: {
    range: (zoom) => [1 - zoom.inMs, zoom.holdMs],
    apply: (zoom, shiftMs) => ({ ...zoom, inMs: zoom.inMs + shiftMs, holdMs: zoom.holdMs - shiftMs }),
  },
  out: {
    range: (zoom) => [-zoom.holdMs, zoom.outMs - 1],
    apply: (zoom, shiftMs) => ({ ...zoom, holdMs: zoom.holdMs + shiftMs, outMs: zoom.outMs - shiftMs }),
  },
  end: {
    range: (zoom, free) => [-zoom.holdMs, free.endMs - zoomRegionEndMs(zoom)],
    apply: (zoom, shiftMs) => ({ ...zoom, holdMs: zoom.holdMs + shiftMs }),
  },
}

function freeSpan(element: ZoomableElement, zoom: ZoomRegion): FreeSpan {
  const siblings = (element.zooms ?? []).filter((other) => other.id !== zoom.id && other.source === zoom.source)
  return {
    startMs: Math.max(0, ...siblings.filter((other) => other.atMs < zoom.atMs).map(zoomRegionEndMs)),
    endMs: Math.min(element.durationMs, ...siblings.filter((other) => other.atMs > zoom.atMs).map((other) => other.atMs)),
  }
}

export function planZoomRegionDrag(element: ZoomableElement, zoom: ZoomRegion, mode: ZoomRegionDragMode, deltaMs: number): ZoomRegion {
  const rule = ZOOM_DRAG_RULES[mode]
  const [minMs, maxMs] = rule.range(zoom, freeSpan(element, zoom))
  if (minMs > maxMs) return zoom
  return rule.apply(zoom, Math.min(maxMs, Math.max(minMs, Math.round(deltaMs))))
}

export type ZoomShape = Pick<ZoomRegion, 'scale' | 'inMs' | 'holdMs' | 'outMs' | 'easing'>

export function planZoomAtPlayhead(
  element: ZoomableElement,
  zoom: keyof typeof ZOOM_REGION_PRESETS | ZoomShape,
  playheadMs: number,
): CommandOfType<'addZoomRegion'> {
  const shape = typeof zoom === 'string' ? { preset: zoom } : zoom
  const { inMs, holdMs, outMs } = typeof zoom === 'string' ? ZOOM_REGION_PRESETS[zoom] : zoom
  const atMs = Math.round(Math.max(0, Math.min(playheadMs - element.startMs, element.durationMs - inMs - holdMs - outMs)))
  const source = element.type === 'multicam' ? (element.sources.find((s) => s.key === 'screen') ?? element.sources[0])?.key : undefined
  return { type: 'addZoomRegion', elementId: element.id, zoom: { ...shape, atMs, ...(source === undefined ? {} : { source }) } }
}
