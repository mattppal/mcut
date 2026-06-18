"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  MaximizeIcon,
  PlusIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@/lib/hugeicons";
import { useEditor, useEditorState, usePlayback, useProject } from "@mcut/react";
import {
  getProjectDurationMs,
  rangesOverlap,
  type ElementId,
} from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useActiveDrag } from "./editor-dnd";
import { PanelHeader } from "./editor-primitives";
import {
  MAX_PX_PER_MS,
  MIN_PX_PER_MS,
  useEditorUI,
} from "./editor-ui";
import { formatTimecode } from "./format";
import {
  ClipDragProvider,
  NEW_TRACK_LANE_HEIGHT,
  RULER_HEIGHT,
  TRACK_HEIGHT,
  useClipDragController,
} from "./timeline-drag";
import { MarkerLines, Playhead, Ruler, SnapGuide } from "./timeline-ruler";
import { DropGhostOverlay, HEADER_WIDTH, NewTrackLane, SortableRow } from "./timeline-tracks";

// ---------------------------------------------------------------------------
// Marquee selection
// ---------------------------------------------------------------------------

interface MarqueeState {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface TimelinePanelProps {
  className?: string;
}

/**
 * Multi-track NLE timeline: magnetic clip move/trim with guide lines,
 * filmstrip/waveform clips, option-drag duplication to new tracks, dnd-kit
 * drop target lanes with ghost preview, marquee + shift multi-select,
 * sortable tracks, ⌘+wheel zoom at pointer.
 */
export function TimelinePanel({ className }: TimelinePanelProps) {
  const engine = useEditor();
  const project = useProject();
  const activeDrag = useActiveDrag();
  const clipDrag = useClipDragController();
  const { pxPerMs, setPxPerMs, zoomBy, timelineScrollRef } = useEditorUI();
  const durationMs = useEditorState((s) => getProjectDurationMs(s.project));
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Quantized: while a drag grows the project, a raw width would change on
  // every frame and defeat the lanes' memoization.
  const contentWidth = Math.max(1600, Math.ceil(((durationMs + 15_000) * pxPerMs) / 400) * 400);
  const mediaDragActive = activeDrag !== null && activeDrag.kind !== "track";
  const rows = [...project.tracks].map((track, index) => ({ track, index })).reverse();
  const totalHeight = RULER_HEIGHT + NEW_TRACK_LANE_HEIGHT + rows.length * TRACK_HEIGHT;

  // ⌘/ctrl+wheel zoom anchored at the pointer (non-passive listener).
  useEffect(() => {
    const scroller = timelineScrollRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = scroller.getBoundingClientRect();
      const anchorMs =
        (scroller.scrollLeft + (event.clientX - rect.left) - HEADER_WIDTH) / pxPerMs;
      zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, Math.max(0, anchorMs));
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [pxPerMs, zoomBy, timelineScrollRef]);

  const fitToView = () => {
    const scroller = timelineScrollRef.current;
    if (!scroller || durationMs === 0) return;
    setPxPerMs((scroller.clientWidth - HEADER_WIDTH - 60) / durationMs);
    scroller.scrollLeft = 0;
  };

  // -- marquee ---------------------------------------------------------------

  const toContentPoint = (event: ReactPointerEvent) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.dataset.mcutLane) return; // clips/headers handle their own
    const point = toContentPoint(event);
    setMarquee({ x0: point.x, y0: point.y, x1: point.x, y1: point.y, active: false });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onBackgroundPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    const point = toContentPoint(event);
    const next = { ...marquee, x1: point.x, y1: point.y };
    next.active =
      next.active || Math.hypot(next.x1 - next.x0, next.y1 - next.y0) > 5;
    setMarquee(next);
    if (!next.active) return;

    // Select clips intersecting the marquee (time × visual rows).
    const fromMs = (Math.min(next.x0, next.x1) - HEADER_WIDTH) / pxPerMs;
    const toMs = (Math.max(next.x0, next.x1) - HEADER_WIDTH) / pxPerMs;
    const rowsTop = RULER_HEIGHT + NEW_TRACK_LANE_HEIGHT;
    const rowTop = Math.floor((Math.min(next.y0, next.y1) - rowsTop) / TRACK_HEIGHT);
    const rowBottom = Math.floor((Math.max(next.y0, next.y1) - rowsTop) / TRACK_HEIGHT);
    const ids: ElementId[] = [];
    rows.forEach(({ track }, visualRow) => {
      if (visualRow < rowTop || visualRow > rowBottom) return;
      for (const element of track.elements) {
        if (rangesOverlap(fromMs, Math.max(1, toMs - fromMs), element.startMs, element.durationMs)) {
          ids.push(element.id);
        }
      }
    });
    engine.select(ids);
  };

  const onBackgroundPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    if (!marquee.active) {
      // Plain click on empty lane: seek there and clear selection.
      engine.seek(Math.max(0, (marquee.x0 - HEADER_WIDTH) / pxPerMs));
      engine.clearSelection();
    }
    setMarquee(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoomSliderValue = Math.log(pxPerMs / MIN_PX_PER_MS) / Math.log(MAX_PX_PER_MS / MIN_PX_PER_MS);

  return (
    <ClipDragProvider value={clipDrag}>
    <div className={cn("flex flex-col", className)} data-mcut-timeline="">
      <PanelHeader>
        <Button
          variant="ghost"
          size="xs"
          title="Add track"
          onClick={() => engine.dispatch({ type: "addTrack" })}
        >
          <PlusIcon /> Track
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" title="Fit timeline" onClick={fitToView}>
          <MaximizeIcon />
        </Button>
        <Button variant="ghost" size="icon-xs" title="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          <ZoomOutIcon />
        </Button>
        <Slider
          value={zoomSliderValue * 100}
          min={0}
          max={100}
          step={1}
          className="w-28! shrink-0"
          onValueChange={(value) => {
            const v = (Array.isArray(value) ? (value[0] ?? 0) : value) / 100;
            setPxPerMs(MIN_PX_PER_MS * Math.pow(MAX_PX_PER_MS / MIN_PX_PER_MS, v));
          }}
        />
        <Button variant="ghost" size="icon-xs" title="Zoom in" onClick={() => zoomBy(1.4)}>
          <ZoomInIcon />
        </Button>
      </PanelHeader>

      <div
        ref={timelineScrollRef}
        // isolate: the sticky ruler/gutter z-indexes (60/70) must not compete
        // with portaled popups (context menus are z-50 at the body level).
        className="relative isolate min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <div
          ref={contentRef}
          className="relative w-max min-w-full"
          style={{ minHeight: totalHeight }}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onBackgroundPointerMove}
          onPointerUp={onBackgroundPointerUp}
        >
          {/* Ruler row */}
          <div className="sticky top-0 z-[60] flex">
            <div
              className="sticky left-0 z-[70] flex shrink-0 items-center justify-center border-r border-foreground/10 bg-card"
              style={{ width: HEADER_WIDTH, height: RULER_HEIGHT }}
            >
              <CurrentTime />
            </div>
            <Ruler pxPerMs={pxPerMs} contentWidth={contentWidth} />
          </div>

          <NewTrackLane contentWidth={contentWidth} dragActive={mediaDragActive} />

          <SortableContext
            items={rows.map(({ track }) => track.id)}
            strategy={verticalListSortingStrategy}
          >
            {rows.map(({ track }) => (
              <SortableRow
                key={track.id}
                track={track}
                pxPerMs={pxPerMs}
                contentWidth={contentWidth}
              />
            ))}
          </SortableContext>

          {durationMs === 0 && !activeDrag && (
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 z-0 flex justify-center text-xs text-muted-foreground"
              style={{ paddingLeft: HEADER_WIDTH }}
            >
              Drag media here, or press the import button in the media bin
            </div>
          )}

          {marquee?.active && (
            <div
              className="pointer-events-none absolute z-40 border border-primary bg-primary/10"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}

          <DropGhostOverlay rows={rows} pxPerMs={pxPerMs} />
          <MarkerLines pxPerMs={pxPerMs} height={totalHeight} />
          <SnapGuide pxPerMs={pxPerMs} height={totalHeight} />
          <Playhead pxPerMs={pxPerMs} height={totalHeight} />
        </div>
      </div>
    </div>
    </ClipDragProvider>
  );
}

function CurrentTime() {
  const currentTimeMs = usePlayback((s) => s.currentTimeMs);
  return (
    <span className="font-mono text-2xs text-primary tabular-nums">
      {formatTimecode(currentTimeMs)}
    </span>
  );
}
