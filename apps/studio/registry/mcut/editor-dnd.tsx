'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { FileVideoIcon, ImageIcon, MusicIcon, TypeIcon } from '@/lib/hugeicons'
import { useEditor, useProject } from '@mcut/react'
import { type AssetRef, type TrackId } from '@mcut/timeline'
import { useDropPreview, useEditorUI, type DropPreview } from './editor-ui'
import { elementForAsset, elementForTextPreset, insertElementOnNewTrack, insertElementOnTrack, type TextPreset } from './editor-actions'
import { collectSnapTargets, pointerToTimelineMs, snapClip, type SnapTarget } from './timeline-snap'
import { formatDurationBadge } from './format'

export type EditorDragData =
  | { kind: 'asset'; asset: AssetRef; thumb?: string }
  | { kind: 'text-preset'; preset: TextPreset }
  | { kind: 'track'; trackId: TrackId }

export interface LaneDropData {
  laneTrackId: string | 'new-track'
}

const ActiveDragContext = createContext<EditorDragData | null>(null)

export function useActiveDrag(): EditorDragData | null {
  return useContext(ActiveDragContext)
}

const SNAP_THRESHOLD_PX = 8

function dragDurationMs(data: EditorDragData): number {
  if (data.kind === 'asset') {
    return data.asset.kind === 'image' ? 4000 : (data.asset.durationMs ?? 3000)
  }
  if (data.kind === 'text-preset') return data.preset.durationMs
  return 0
}

function dragLabel(data: EditorDragData): string {
  if (data.kind === 'asset') return data.asset.name ?? data.asset.kind
  if (data.kind === 'text-preset') return data.preset.name
  return ''
}

function isLaneDropData(data: unknown): data is LaneDropData {
  return typeof data === 'object' && data !== null && 'laneTrackId' in data && typeof (data as LaneDropData).laneTrackId === 'string'
}

function isEditorDragData(data: unknown): data is EditorDragData {
  return typeof data === 'object' && data !== null && 'kind' in data && typeof data.kind === 'string'
}

function dragDataOf(active: Active): EditorDragData | null {
  const data = active.data.current
  return isEditorDragData(data) ? data : null
}

const collisionDetection: CollisionDetection = (args) => {
  if (dragDataOf(args.active)?.kind === 'track') return closestCenter(args)
  const droppableContainers = args.droppableContainers.filter((container) => {
    const dropData = container.data.current
    return isLaneDropData(dropData)
  })
  return pointerWithin({ ...args, droppableContainers })
}

function DragGhost({ data }: { data: EditorDragData }) {
  const preview = useDropPreview()
  const Icon =
    data.kind === 'text-preset'
      ? TypeIcon
      : data.kind === 'asset' && data.asset.kind === 'video'
        ? FileVideoIcon
        : data.kind === 'asset' && data.asset.kind === 'audio'
          ? MusicIcon
          : ImageIcon
  const thumb = data.kind === 'asset' ? data.thumb : undefined
  if (preview) return null
  return (
    <div className="pointer-events-none flex w-44 items-center gap-2 rounded-lg border bg-popover p-1.5 shadow-xl ring-1 ring-primary/40">
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="size-full object-cover" />
        ) : (
          <Icon className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{dragLabel(data)}</p>
        <p className="font-mono text-2xs text-muted-foreground">{formatDurationBadge(dragDurationMs(data))}</p>
      </div>
    </div>
  )
}

export function EditorDnd({ children, onTrackSort }: { children: ReactNode; onTrackSort?: (activeTrackId: string, overTrackId: string) => void }) {
  const engine = useEditor()
  const project = useProject()
  const { pxPerMs, snapEnabled, editMode, setDropPreview, setSnapGuideMs } = useEditorUI()
  const [drag, setDrag] = useState<{ data: EditorDragData; snapTargets: SnapTarget[] } | null>(null)
  const activeDrag = drag?.data ?? null

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const clear = () => {
    setDrag(null)
    setDropPreview(null)
    setSnapGuideMs(null)
  }

  const previewFor = (event: DragMoveEvent): DropPreview | null => {
    const data = dragDataOf(event.active)
    if (!data || data.kind === 'track') return null
    const over = event.over
    const laneData = over?.data.current as LaneDropData | undefined
    if (!over || !laneData?.laneTrackId) return null

    const activator = event.activatorEvent as PointerEvent
    const pointerX = (activator.clientX ?? 0) + event.delta.x
    const durationMs = dragDurationMs(data)
    const rawMs = pointerToTimelineMs(pointerX, over.rect, pxPerMs)
    const snapped = snapClip(rawMs, durationMs, drag?.snapTargets ?? [], SNAP_THRESHOLD_PX / pxPerMs, {
      enabled: snapEnabled,
      fps: project.fps,
    })
    return {
      trackId: laneData.laneTrackId,
      startMs: Math.max(0, snapped.ms),
      durationMs,
      label: dragLabel(data),
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const data = dragDataOf(event.active)
    setDrag(data ? { data, snapTargets: collectSnapTargets(project, engine.playback.state.currentTimeMs) } : null)
    setSnapGuideMs(null)
  }

  const handleDragMove = (event: DragMoveEvent) => {
    const data = dragDataOf(event.active)
    if (!data || data.kind === 'track') return
    setDropPreview(previewFor(event))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const data = dragDataOf(event.active)
    try {
      if (data?.kind === 'track') {
        const overId = event.over?.id
        if (overId && overId !== event.active.id && onTrackSort) {
          onTrackSort(String(event.active.id), String(overId))
        }
        return
      }
      const preview = previewFor(event)
      if (!data || !preview) return
      const element = data.kind === 'asset' ? elementForAsset(engine, data.asset) : elementForTextPreset(engine, data.preset)
      if (preview.trackId === 'new-track') {
        insertElementOnNewTrack(engine, element, preview.startMs)
      } else {
        insertElementOnTrack(engine, preview.trackId as TrackId, element, preview.startMs, editMode)
      }
    } finally {
      clear()
    }
  }

  return (
    <DndContext
      id="mcut-editor-dnd"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={clear}
    >
      <ActiveDragContext.Provider value={activeDrag}>
        {children}
        <DragOverlay dropAnimation={null}>{activeDrag && activeDrag.kind !== 'track' ? <DragGhost data={activeDrag} /> : null}</DragOverlay>
      </ActiveDragContext.Provider>
    </DndContext>
  )
}
