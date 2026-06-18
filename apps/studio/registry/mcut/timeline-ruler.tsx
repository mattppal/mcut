"use client";

// Ruler + playhead: scrub-to-seek tick ruler, draggable marker flags and guide lines, the playhead, and the snap guide.

import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, useEditorState, usePlayback, useProject } from "@mcut/react";
import { type CaptionElement } from "@mcut/timeline";
import { searchCaptions } from "@mcut/transcription";
import { useTranscriptKeywords } from "./transcript-keywords";
import { useEditorUI, useSnapGuideMs } from "./editor-ui";
import { formatRulerLabel } from "./format";
import { RULER_HEIGHT } from "./timeline-drag";
import { HEADER_WIDTH } from "./timeline-tracks";

// ---------------------------------------------------------------------------
// Ruler + playhead
// ---------------------------------------------------------------------------

/**
 * Marker flags on the ruler: click seeks, drag retimes (one undo per
 * gesture), ⌥-click removes. Add/navigate via M / ⇧M / ⌥M or the palette.
 */
function RulerMarkers({ pxPerMs }: { pxPerMs: number }) {
  const engine = useEditor();
  const markers = useEditorState((s) => s.project.markers);
  const dragRef = useRef<{ id: string; startClientX: number; startMs: number; moved: boolean } | null>(
    null,
  );

  return (
    <>
      {markers.map((marker) => (
        <span
          key={marker.id}
          title={`${marker.label ?? "Marker"} · drag to retime · ⌥-click to remove`}
          className="absolute bottom-0 z-10 flex h-3.5 w-[11px] -translate-x-1/2 cursor-pointer justify-center"
          style={{ left: marker.timeMs * pxPerMs }}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.button !== 0) return;
            if (event.altKey) {
              try {
                engine.dispatch({ type: "removeMarker", markerId: marker.id });
              } catch {
                // Marker vanished.
              }
              return;
            }
            dragRef.current = {
              id: marker.id,
              startClientX: event.clientX,
              startMs: marker.timeMs,
              moved: false,
            };
            engine.beginTransaction();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.id !== marker.id) return;
            if (Math.abs(event.clientX - drag.startClientX) > 3) drag.moved = true;
            if (!drag.moved) return;
            const toMs = Math.max(0, Math.round(drag.startMs + (event.clientX - drag.startClientX) / pxPerMs));
            try {
              engine.dispatch({ type: "updateMarker", markerId: drag.id, timeMs: toMs });
            } catch {
              // Marker vanished mid-drag.
            }
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.id !== marker.id) return;
            dragRef.current = null;
            engine.endTransaction();
            event.currentTarget.releasePointerCapture(event.pointerId);
            if (!drag.moved) engine.seek(marker.timeMs);
          }}
        >
          <span
            className="h-full w-[7px] rounded-[2px] rounded-b-none [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]"
            style={{ backgroundColor: marker.color ?? "var(--snap-guide)" }}
          />
        </span>
      ))}
    </>
  );
}

/**
 * Soft ticks for transcript keyword occurrences (persisted in the
 * transcript panel): hover names the keyword, click seeks to the word.
 */
function KeywordTicks({ pxPerMs }: { pxPerMs: number }) {
  const engine = useEditor();
  const project = useProject();
  const keywords = useTranscriptKeywords(project.id);
  const occurrences = useMemo(() => {
    if (keywords.length === 0) return [];
    const captions = project.tracks
      .flatMap((track) => track.elements)
      .filter((e): e is CaptionElement => e.type === "caption");
    return keywords.flatMap((keyword) =>
      searchCaptions(captions, keyword).map((match) => ({ keyword, timeMs: match.timeMs })),
    );
  }, [project, keywords]);
  return (
    <>
      {occurrences.map(({ keyword, timeMs }, i) => (
        <button
          key={`${keyword}-${timeMs}-${i}`}
          type="button"
          title={`“${keyword}” — click to seek`}
          className="absolute bottom-0 h-1.5 w-[3px] -translate-x-1/2 cursor-pointer rounded-t-sm bg-(--clip-caption)/70 hover:bg-(--clip-caption)"
          style={{ left: timeMs * pxPerMs }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => engine.seek(timeMs)}
        />
      ))}
    </>
  );
}

/** Thin guide line under each marker, across the full track area. */
export function MarkerLines({ pxPerMs, height }: { pxPerMs: number; height: number }) {
  const markers = useEditorState((s) => s.project.markers);
  return (
    <>
      {markers.map((marker) => (
        <div
          key={marker.id}
          className="pointer-events-none absolute top-0 z-0 w-px opacity-35"
          style={{
            left: HEADER_WIDTH + marker.timeMs * pxPerMs,
            height,
            backgroundColor: marker.color ?? "var(--snap-guide)",
          }}
        />
      ))}
    </>
  );
}

export function Ruler({ pxPerMs, contentWidth }: { pxPerMs: number; contentWidth: number }) {
  const engine = useEditor();
  const scrubbingRef = useRef(false);

  const seekFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    engine.seek(Math.max(0, (event.clientX - rect.left) / pxPerMs));
  };

  const steps = [100, 250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 300_000];
  const stepMs = steps.find((s) => s * pxPerMs >= 70) ?? 300_000;
  const minorMs = stepMs / 5;
  const minorPx = minorMs * pxPerMs;
  const tickCount = Math.ceil(contentWidth / (stepMs * pxPerMs)) + 1;

  return (
    <div
      className="relative cursor-col-resize bg-card"
      style={{
        width: contentWidth,
        height: RULER_HEIGHT,
        backgroundImage: `repeating-linear-gradient(to right, color-mix(in oklab, var(--foreground) 14%, transparent) 0 1px, transparent 1px ${minorPx}px)`,
        backgroundSize: `${minorPx}px 6px`,
        backgroundPosition: "0 100%",
        backgroundRepeat: "repeat-x",
      }}
      onPointerDown={(event) => {
        scrubbingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromEvent(event);
      }}
      onPointerMove={(event) => scrubbingRef.current && seekFromEvent(event)}
      onPointerUp={(event) => {
        scrubbingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      {Array.from({ length: tickCount }, (_, i) => (
        <div
          key={i}
          className="absolute top-0 h-full border-l border-foreground/15 pl-1 pt-1 font-mono text-2xs leading-none text-muted-foreground select-none"
          style={{ left: i * stepMs * pxPerMs }}
        >
          {formatRulerLabel(i * stepMs)}
        </div>
      ))}
      <RulerMarkers pxPerMs={pxPerMs} />
      <KeywordTicks pxPerMs={pxPerMs} />
    </div>
  );
}

export function Playhead({ pxPerMs, height }: { pxPerMs: number; height: number }) {
  const currentTimeMs = usePlayback((s) => s.currentTimeMs);
  const isPlaying = usePlayback((s) => s.isPlaying);
  const { timelineScrollRef } = useEditorUI();

  // Follow the playhead while playing (manual scrolling stays untouched
  // when paused).
  useEffect(() => {
    if (!isPlaying) return;
    const scroller = timelineScrollRef.current;
    if (!scroller) return;
    const playheadX = HEADER_WIDTH + currentTimeMs * pxPerMs;
    const viewLeft = scroller.scrollLeft + HEADER_WIDTH;
    const viewRight = scroller.scrollLeft + scroller.clientWidth - 40;
    if (playheadX < viewLeft || playheadX > viewRight) {
      scroller.scrollLeft = Math.max(0, playheadX - HEADER_WIDTH - 80);
    }
  }, [currentTimeMs, isPlaying, pxPerMs, timelineScrollRef]);

  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-px bg-primary"
      style={{ left: HEADER_WIDTH + currentTimeMs * pxPerMs, height }}
    >
      <div className="absolute -top-px -left-[5.5px] flex h-4 w-3 items-start justify-center">
        <div className="h-3 w-3 rounded-[3px] rounded-b-none bg-primary [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]" />
      </div>
    </div>
  );
}

export function SnapGuide({ pxPerMs, height }: { pxPerMs: number; height: number }) {
  const snapGuideMs = useSnapGuideMs();
  if (snapGuideMs === null) return null;
  return (
    <div
      className="pointer-events-none absolute top-0 z-30 w-px bg-(--snap-guide)"
      style={{ left: HEADER_WIDTH + snapGuideMs * pxPerMs, height }}
    />
  );
}
