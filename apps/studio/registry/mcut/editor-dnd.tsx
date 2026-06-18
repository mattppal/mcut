"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FileVideoIcon, ImageIcon, MusicIcon, TypeIcon } from "@/lib/hugeicons";
import { useEditor, useProject } from "@mcut/react";
import {
  type AssetRef,
  type TrackId,
} from "@mcut/timeline";
import { useDropPreview, useEditorUI, type DropPreview } from "./editor-ui";
import {
  elementForAsset,
  elementForTextPreset,
  insertElementOnNewTrack,
  insertElementOnTrack,
  type TextPreset,
} from "./editor-actions";
import { collectSnapTargets, pointerToTimelineMs, snapClip, type SnapTarget } from "./timeline-snap";
import { formatDurationBadge } from "./format";

/** Payloads carried by dnd-kit drags. Track sorting is handled separately. */
export type EditorDragData =
  | { kind: "asset"; asset: AssetRef; thumb?: string }
  | { kind: "text-preset"; preset: TextPreset }
  | { kind: "track"; trackId: TrackId };

/** Data attached to timeline lane droppables. */
export interface LaneDropData {
  laneTrackId: string | "new-track";
}

const ActiveDragContext = createContext<EditorDragData | null>(null);

/** The payload currently being dragged (null when idle). */
export function useActiveDrag(): EditorDragData | null {
  return useContext(ActiveDragContext);
}

const SNAP_THRESHOLD_PX = 8;

function dragDurationMs(data: EditorDragData): number {
  if (data.kind === "asset") {
    return data.asset.kind === "image" ? 4000 : (data.asset.durationMs ?? 3000);
  }
  if (data.kind === "text-preset") return data.preset.durationMs;
  return 0;
}

function dragLabel(data: EditorDragData): string {
  if (data.kind === "asset") return data.asset.name ?? data.asset.kind;
  if (data.kind === "text-preset") return data.preset.name;
  return "";
}

function isLaneDropData(data: unknown): data is LaneDropData {
  return (
    typeof data === "object" &&
    data !== null &&
    "laneTrackId" in data &&
    typeof (data as LaneDropData).laneTrackId === "string"
  );
}

/** Lanes get pointer-precision; track sorting wants nearest-row. */
const collisionDetection: CollisionDetection = (args) => {
  const data = args.active.data.current as EditorDragData | undefined;
  if (data?.kind === "track") return closestCenter(args);
  const droppableContainers = args.droppableContainers.filter((container) => {
    const dropData = container.data.current;
    return isLaneDropData(dropData);
  });
  return pointerWithin({ ...args, droppableContainers });
};

function DragGhost({ data }: { data: EditorDragData }) {
  // Once the in-lane ghost is live, the floating card would only cover it —
  // the snapped ghost (with its own label/timecode) is the better feedback.
  const preview = useDropPreview();
  const Icon =
    data.kind === "text-preset"
      ? TypeIcon
      : data.kind === "asset" && data.asset.kind === "video"
        ? FileVideoIcon
        : data.kind === "asset" && data.asset.kind === "audio"
          ? MusicIcon
          : ImageIcon;
  const thumb = data.kind === "asset" ? data.thumb : undefined;
  if (preview) return null;
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
        <p className="font-mono text-2xs text-muted-foreground">
          {formatDurationBadge(dragDurationMs(data))}
        </p>
      </div>
    </div>
  );
}

/**
 * One DndContext for the whole editor: media-bin assets and text presets
 * drag onto timeline lanes (with a snapped in-lane ghost), track rows sort
 * vertically. Clip move/trim stays on raw pointer events for ms precision.
 */
export function EditorDnd({
  children,
  onTrackSort,
}: {
  children: ReactNode;
  /** Called when a track row is dropped over another (sortable ids). */
  onTrackSort?: (activeTrackId: string, overTrackId: string) => void;
}) {
  const engine = useEditor();
  const project = useProject();
  const { pxPerMs, snapEnabled, editMode, setDropPreview, setSnapGuideMs } = useEditorUI();
  const [activeDrag, setActiveDrag] = useState<EditorDragData | null>(null);
  // Snap targets are stable for the whole drag (only the dragged payload
  // moves), so collect them once at drag start instead of per pointermove.
  const snapTargetsRef = useRef<SnapTarget[]>([]);
  // Coalesce drag moves to the frame rate: pointermove can fire at 120Hz+.
  const moveFrameRef = useRef<number | null>(null);
  const lastMoveRef = useRef<DragMoveEvent | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const clear = () => {
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    lastMoveRef.current = null;
    setActiveDrag(null);
    setDropPreview(null);
    setSnapGuideMs(null);
  };

  const previewFor = (event: DragMoveEvent): DropPreview | null => {
    const data = event.active.data.current as EditorDragData | undefined;
    if (!data || data.kind === "track") return null;
    const over = event.over;
    const laneData = over?.data.current as LaneDropData | undefined;
    if (!over || !laneData?.laneTrackId) return null;

    const activator = event.activatorEvent as PointerEvent;
    const pointerX = (activator.clientX ?? 0) + event.delta.x;
    const durationMs = dragDurationMs(data);
    const rawMs = pointerToTimelineMs(pointerX, over.rect, pxPerMs);
    const snapped = snapClip(rawMs, durationMs, snapTargetsRef.current, SNAP_THRESHOLD_PX / pxPerMs, {
      enabled: snapEnabled,
      fps: project.fps,
    });
    return {
      trackId: laneData.laneTrackId,
      startMs: Math.max(0, snapped.ms),
      durationMs,
      label: dragLabel(data),
    };
  };

  const handleDragStart = (event: DragStartEvent) => {
    snapTargetsRef.current = collectSnapTargets(project, engine.playback.state.currentTimeMs);
    setActiveDrag((event.active.data.current as EditorDragData) ?? null);
    setSnapGuideMs(null); // guide is implied by the ghost edges; keep UI quiet
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const data = event.active.data.current as EditorDragData | undefined;
    if (!data || data.kind === "track") return;
    // Leading + trailing: apply the first move immediately, fold any burst
    // that follows into one update on the next frame.
    lastMoveRef.current = event;
    if (moveFrameRef.current !== null) return;
    setDropPreview(previewFor(event));
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      const last = lastMoveRef.current;
      if (last) setDropPreview(previewFor(last));
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current as EditorDragData | undefined;
    try {
      if (data?.kind === "track") {
        const overId = event.over?.id;
        if (overId && overId !== event.active.id && onTrackSort) {
          onTrackSort(String(event.active.id), String(overId));
        }
        return;
      }
      const preview = previewFor(event);
      if (!data || !preview) return;
      const element =
        data.kind === "asset"
          ? elementForAsset(engine, data.asset)
          : elementForTextPreset(engine, data.preset);
      if (preview.trackId === "new-track") {
        insertElementOnNewTrack(engine, element, preview.startMs);
      } else {
        insertElementOnTrack(engine, preview.trackId as TrackId, element, preview.startMs, editMode);
      }
    } finally {
      clear();
    }
  };

  return (
    <DndContext
      id="mcut-editor-dnd"
      sensors={sensors}
      collisionDetection={collisionDetection}
      // Default measuring (once per drag) is enough: the "new track" lane is
      // always mounted, so rows never shift when a drag starts.
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={clear}
    >
      <ActiveDragContext.Provider value={activeDrag}>
        {children}
        <DragOverlay dropAnimation={null}>
          {activeDrag && activeDrag.kind !== "track" ? <DragGhost data={activeDrag} /> : null}
        </DragOverlay>
      </ActiveDragContext.Provider>
    </DndContext>
  );
}
