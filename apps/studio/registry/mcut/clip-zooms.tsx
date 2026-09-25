'use client'

import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'
import { planZoomRegionDrag, type ZoomRegionDragMode } from '@mcut/editor'
import { useEditor } from '@mcut/react'
import { getLinkedElementIds, type BuiltinCommand, type ZoomableElement, type ZoomRegion } from '@mcut/timeline'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'

const LANE_ROW_PX = 16
const CLICK_SLOP_PX = 3
const TIMING_FIELDS = ['atMs', 'inMs', 'holdMs', 'outMs'] as const

interface ZoomDrag {
  mode: ZoomRegionDragMode
  originX: number
  draft: ZoomRegion
}

const ZOOM_EDGES: ReadonlyArray<{ mode: Exclude<ZoomRegionDragMode, 'move'>; offsetMs: (zoom: ZoomRegion) => number; title: string }> = [
  { mode: 'start', offsetMs: () => 0, title: 'Drag to start the zoom earlier or later. Its end stays put' },
  { mode: 'in', offsetMs: (zoom) => zoom.inMs, title: 'Drag to change how long the zoom takes to punch in' },
  { mode: 'out', offsetMs: (zoom) => zoom.inMs + zoom.holdMs, title: 'Drag to change how long the zoom takes to ease out' },
  { mode: 'end', offsetMs: (zoom) => zoom.inMs + zoom.holdMs + zoom.outMs, title: 'Drag to change how long the zoom holds' },
]

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

const DRAG_READOUTS: Record<ZoomRegionDragMode, (zoom: ZoomRegion) => string> = {
  move: (zoom) => `${seconds(zoom.atMs)} into the clip`,
  start: (zoom) => `${seconds(zoom.holdMs)} hold`,
  in: (zoom) => `${seconds(zoom.inMs)} in`,
  out: (zoom) => `${seconds(zoom.outMs)} out`,
  end: (zoom) => `${seconds(zoom.holdMs)} hold`,
}

function zoomLabel(zoom: ZoomRegion): string {
  const scale = `${Number(zoom.scale.toFixed(2))}x`
  return zoom.source === undefined ? scale : `${scale} ${zoom.source}`
}

export function ZoomLane({ element, pxPerMs }: { element: ZoomableElement; pxPerMs: number }) {
  const zooms = element.zooms ?? []
  const rows = [...new Set(zooms.map((zoom) => zoom.source))]
  return (
    <>
      {zooms.map((zoom) => (
        <ZoomBlock key={zoom.id} element={element} zoom={zoom} pxPerMs={pxPerMs} topPx={rows.indexOf(zoom.source) * LANE_ROW_PX} />
      ))}
    </>
  )
}

function ZoomBlock({ element, zoom, pxPerMs, topPx }: { element: ZoomableElement; zoom: ZoomRegion; pxPerMs: number; topPx: number }) {
  const engine = useEditor()
  const [drag, setDrag] = useState<ZoomDrag | null>(null)
  const shown = drag?.draft ?? zoom
  const holdStartMs = shown.inMs
  const holdEndMs = shown.inMs + shown.holdMs
  const spanMs = holdEndMs + shown.outMs
  const label = zoomLabel(zoom)

  const dispatch = (command: BuiltinCommand) => {
    try {
      engine.dispatch(command)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Zoom edit failed')
    }
  }

  const selectClip = () => {
    if (!engine.selection.elementIds.includes(element.id)) engine.select(getLinkedElementIds(engine.project, element.id))
  }

  const plan = (active: ZoomDrag, clientX: number) => {
    const dx = clientX - active.originX
    return Math.abs(dx) < CLICK_SLOP_PX ? zoom : planZoomRegionDrag(element, zoom, active.mode, dx / pxPerMs)
  }

  const begin = (event: ReactPointerEvent<HTMLElement>, mode: ZoomRegionDragMode) => {
    if (event.button !== 0) return
    event.stopPropagation()
    selectClip()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ mode, originX: event.clientX, draft: zoom })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag) setDrag({ ...drag, draft: plan(drag, event.clientX) })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return
    setDrag(null)
    const next = plan(drag, event.clientX)
    const patch: Partial<Pick<ZoomRegion, (typeof TIMING_FIELDS)[number]>> = {}
    for (const field of TIMING_FIELDS) if (next[field] !== zoom[field]) patch[field] = next[field]
    if (Object.keys(patch).length === 0) return
    dispatch({ type: 'updateZoomRegion', elementId: element.id, zoomId: zoom.id, patch })
  }

  const remove = () => dispatch({ type: 'removeZoomRegion', elementId: element.id, zoomId: zoom.id })

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setDrag(null)
      event.currentTarget.blur()
      return
    }
    if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    remove()
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            tabIndex={0}
            data-mcut-zoom={zoom.id}
            title={`${label} zoom. Drag to move it, or press Delete to remove it`}
            className={cn(
              'absolute z-30 flex cursor-grab touch-none items-center justify-center rounded-sm bg-overlay/45 ring-1 ring-overlay-foreground/30 outline-none select-none focus:ring-2 focus:ring-overlay-foreground active:cursor-grabbing',
              drag && 'bg-overlay/65',
            )}
            style={{ left: shown.atMs * pxPerMs, width: spanMs * pxPerMs, top: topPx, height: LANE_ROW_PX }}
            onPointerDown={(event) => begin(event, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={onKeyDown}
            onContextMenu={selectClip}
          />
        }
      >
        <svg className="pointer-events-none absolute inset-0 size-full rounded-sm" viewBox={`0 0 ${spanMs} 1`} preserveAspectRatio="none" aria-hidden="true">
          <path d={`M 0 1 L ${holdStartMs} 0.15 V 1 Z M ${holdEndMs} 0.15 L ${spanMs} 1 H ${holdEndMs} Z`} className="fill-overlay-foreground/20" />
          <rect x={holdStartMs} y={0.15} width={shown.holdMs} height={0.85} className="fill-overlay-foreground/35" />
          <path
            d={`M 0 1 L ${holdStartMs} 0.15 H ${holdEndMs} L ${spanMs} 1`}
            fill="none"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            className="stroke-overlay-foreground/90"
          />
        </svg>
        <span className="pointer-events-none relative truncate px-1 font-mono text-2xs text-overlay-foreground">
          {drag ? DRAG_READOUTS[drag.mode](shown) : label}
        </span>
        {ZOOM_EDGES.map((edge) => (
          <span
            key={edge.mode}
            title={edge.title}
            data-zoom-edge={edge.mode}
            className="absolute inset-y-0 w-1.5 -translate-x-1/2 cursor-ew-resize rounded-full transition-colors hover:bg-overlay-foreground/50"
            style={{ left: edge.offsetMs(shown) * pxPerMs }}
            onPointerDown={(event) => begin(event, edge.mode)}
          />
        ))}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={remove}>
          Delete zoom
          <span className="ml-auto pl-4 font-mono text-2xs text-muted-foreground">⌫</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
