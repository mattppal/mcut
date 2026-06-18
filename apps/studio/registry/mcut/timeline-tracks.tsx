"use client";

// Track rows: header controls, sortable clip lanes with dnd-kit drop targets, and the drop ghost overlay.

import { createElement, memo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  LayersIcon,
  LockIcon,
  LockOpenIcon,
  MagnetIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "@/lib/hugeicons";
import { useEditor, useEditorState } from "@mcut/react";
import { type Track } from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { getElementUI } from "./element-ui";
import { isSoloTrack, selectTrackElements, toggleSoloTrack } from "./editor-actions";
import { type LaneDropData } from "./editor-dnd";
import { TIMELINE_HEADER_WIDTH, useDropPreview } from "./editor-ui";
import { formatTimecode } from "./format";
import { NEW_TRACK_LANE_HEIGHT, RULER_HEIGHT, TRACK_HEIGHT } from "./timeline-drag";
import { Clip } from "./timeline-clip";

export const HEADER_WIDTH = TIMELINE_HEADER_WIDTH;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trackIcon(track: Track) {
  const first = track.elements[0]?.type;
  if (!first) return LayersIcon;
  return getElementUI(first).icon;
}

// ---------------------------------------------------------------------------
// Track header + lane
// ---------------------------------------------------------------------------

function TrackHeader({
  track,
  gripProps,
}: {
  track: Track;
  gripProps?: Record<string, unknown>;
}) {
  const engine = useEditor();
  const [renaming, setRenaming] = useState(false);
  const setFlag = (patch: Partial<Pick<Track, "muted" | "hidden" | "locked" | "magnetic">>) =>
    engine.dispatch({ type: "setTrackFlags", trackId: track.id, ...patch });
  // Subscriptions, not engine.project reads: these depend on OTHER tracks'
  // flags, which no longer reach this memoized row as props.
  const timelineMagnetEnabled = useEditorState((s) =>
    s.project.tracks.some((candidate) => candidate.magnetic),
  );
  const solo = useEditorState(() => isSoloTrack(engine, track.id));
  const setTimelineMagnet = (magnetic: boolean) => {
    const tracks = [...engine.project.tracks];
    engine.transact(() => {
      for (const candidate of tracks) {
        // Caption tracks keep transcript timing — never compact them.
        const isCaptionTrack =
          candidate.elements.length > 0 && candidate.elements.every((e) => e.type === "caption");
        if (isCaptionTrack) continue;
        if (candidate.magnetic !== magnetic) {
          engine.dispatch({ type: "setTrackFlags", trackId: candidate.id, magnetic });
        }
      }
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className="group/header sticky left-0 z-50 flex shrink-0 items-center gap-1 border-r border-foreground/10 bg-card pr-2 pl-0.5"
            style={{ width: HEADER_WIDTH, height: TRACK_HEIGHT }}
            onClick={(event) => {
              // Header click selects the track's clips (buttons handle themselves).
              if ((event.target as HTMLElement).closest("button, input")) return;
              selectTrackElements(engine, track.id);
            }}
          />
        }
      >
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground"
          aria-label="Reorder track"
          {...gripProps}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        {createElement(trackIcon(track), {
          className: "size-3.5 shrink-0 text-muted-foreground",
        })}
        {renaming ? (
          <Input
            autoFocus
            defaultValue={track.name}
            className="h-5 flex-1 px-1 text-2xs"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== track.name) {
                engine.dispatch({ type: "renameTrack", trackId: track.id, name });
              }
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span
            className="min-w-6 flex-1 truncate text-2xs font-medium"
            onDoubleClick={() => setRenaming(true)}
          >
            {track.name}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          title={track.muted ? "Unmute track" : "Mute track"}
          onClick={() => setFlag({ muted: !track.muted })}
        >
          {track.muted ? <VolumeXIcon className="text-destructive" /> : <Volume2Icon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          title={track.hidden ? "Show track" : "Hide track"}
          onClick={() => setFlag({ hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOffIcon className="text-destructive" /> : <EyeIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          title={track.locked ? "Unlock track" : "Lock track"}
          onClick={() => setFlag({ locked: !track.locked })}
        >
          {track.locked ? <LockIcon className="text-destructive" /> : <LockOpenIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn("size-5", timelineMagnetEnabled ? "bg-primary/20 text-primary" : "text-muted-foreground")}
          title={timelineMagnetEnabled ? "Disable timeline magnet" : "Enable timeline magnet"}
          onClick={() => setTimelineMagnet(!timelineMagnetEnabled)}
        >
          <MagnetIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            "size-5 font-mono text-2xs font-bold",
            solo ? "bg-primary/20 text-primary" : "text-muted-foreground",
          )}
          title="Solo track (mute all others)"
          onClick={() => toggleSoloTrack(engine, track.id)}
        >
          S
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 opacity-0 transition-opacity group-hover/header:opacity-100 hover:text-destructive"
          title="Delete track"
          onClick={() => engine.dispatch({ type: "removeTrack", trackId: track.id })}
        >
          <XIcon />
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => selectTrackElements(engine, track.id)}>
          Select clips
        </ContextMenuItem>
        <ContextMenuItem onClick={() => setRenaming(true)}>Rename</ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const index = engine.project.tracks.findIndex((t) => t.id === track.id);
            engine.dispatch({ type: "addTrack", index: index + 1 }); // above = later in paint order
          }}
        >
          Insert track above
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const index = engine.project.tracks.findIndex((t) => t.id === track.id);
            engine.dispatch({ type: "addTrack", index });
          }}
        >
          Insert track below
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => engine.dispatch({ type: "removeTrack", trackId: track.id })}
        >
          Delete track
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The lane's droppable lives in its own tiny child: dnd-kit re-renders every
 * useDroppable consumer whenever `over` changes (each lane crossing), and
 * isolating it here keeps those re-renders away from the Lane and its clips.
 */
function LaneDropTarget({ trackId }: { trackId: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane-${trackId}`,
    data: { laneTrackId: trackId } satisfies LaneDropData,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn("pointer-events-none absolute inset-0", isOver && "bg-primary/5")}
    />
  );
}

// Memoized on track identity: the engine shares structure, so a dispatch
// only changes the touched track — every other lane bails right here.
const Lane = memo(function Lane({
  track,
  pxPerMs,
  contentWidth,
}: {
  track: Track;
  pxPerMs: number;
  contentWidth: number;
}) {
  return (
    <div
      data-mcut-lane={track.id}
      className={cn(
        "relative before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-1 before:rounded-lg before:bg-foreground/[0.045]",
        track.locked && "opacity-60",
        track.hidden && "[&_[data-mcut-clip]]:opacity-50",
      )}
      style={{ width: contentWidth, height: TRACK_HEIGHT }}
    >
      <LaneDropTarget trackId={track.id} />
      {track.elements.map((element) => (
        <Clip key={element.id} element={element} track={track} pxPerMs={pxPerMs} />
      ))}
    </div>
  );
});

export const SortableRow = memo(function SortableRow({
  track,
  pxPerMs,
  contentWidth,
}: {
  track: Track;
  pxPerMs: number;
  contentWidth: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
    data: { kind: "track", trackId: track.id },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn("flex", isDragging && "z-40 opacity-70")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <TrackHeader track={track} gripProps={{ ...attributes, ...listeners }} />
      <Lane track={track} pxPerMs={pxPerMs} contentWidth={contentWidth} />
    </div>
  );
});

/**
 * Always mounted (the drop affordance just fades in while a drag is live):
 * mounting it on drag start used to shift every row down mid-gesture, which
 * both jolted the rows and forced dnd-kit to re-measure lanes on a timer.
 */
export function NewTrackLane({ contentWidth, dragActive }: { contentWidth: number; dragActive: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "lane-new-track",
    data: { laneTrackId: "new-track" } satisfies LaneDropData,
  });
  return (
    <div className="flex">
      <div
        className="sticky left-0 z-50 flex shrink-0 items-center justify-center border-r border-foreground/10 bg-card text-2xs text-muted-foreground"
        style={{ width: HEADER_WIDTH, height: NEW_TRACK_LANE_HEIGHT }}
      >
        <span className={cn("transition-opacity", dragActive ? "opacity-100" : "opacity-0")}>
          New track
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "relative before:pointer-events-none before:absolute before:inset-x-1 before:inset-y-0.5 before:rounded-lg before:border before:border-dashed before:border-primary/35 before:opacity-0 before:transition-opacity",
          dragActive && "before:opacity-100",
          isOver && "bg-primary/10",
        )}
        style={{ width: contentWidth, height: NEW_TRACK_LANE_HEIGHT }}
      />
    </div>
  );
}

/**
 * The single drop ghost for media/text drags, rendered as one overlay over
 * the rows (per-lane ghost subscriptions would re-render every lane per
 * pointermove). Subscribes to the drop-preview store, so a drag move
 * re-renders exactly this component.
 */
export function DropGhostOverlay({
  rows,
  pxPerMs,
}: {
  rows: Array<{ track: Track }>;
  pxPerMs: number;
}) {
  const ghost = useDropPreview();
  if (!ghost) return null;
  let top = RULER_HEIGHT + 4;
  let height = NEW_TRACK_LANE_HEIGHT - 8;
  if (ghost.trackId !== "new-track") {
    const row = rows.findIndex(({ track }) => track.id === ghost.trackId);
    if (row === -1) return null;
    top = RULER_HEIGHT + NEW_TRACK_LANE_HEIGHT + row * TRACK_HEIGHT + 4;
    height = TRACK_HEIGHT - 8;
  }
  return (
    <div
      data-mcut-drop-ghost=""
      className="pointer-events-none absolute z-40 flex items-end gap-1.5 overflow-hidden rounded-lg border border-primary/80 bg-primary/25 px-1.5 py-0.5 shadow-[0_14px_32px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.14),inset_0_1px_0_rgba(255,255,255,0.18)] ring-1 ring-primary/35"
      style={{
        left: HEADER_WIDTH + ghost.startMs * pxPerMs,
        top,
        height,
        width: Math.max(10, ghost.durationMs * pxPerMs),
      }}
    >
      <span className="truncate text-2xs font-medium text-primary">{ghost.label}</span>
      <span className="shrink-0 font-mono text-2xs text-primary/80 tabular-nums">
        {formatTimecode(ghost.startMs)}
      </span>
    </div>
  );
}
