"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "@mcut/react";
import type { TimelineElement } from "@mcut/timeline";
import { cn } from "@/lib/utils";

type FadeableClip = TimelineElement & { type: "video" | "audio" | "multicam" };

/**
 * Audio fade handles on a clip: a dot at each top corner that drags inward
 * to set `fadeInMs`/`fadeOutMs`, with the faded span shaded as a ramp wedge
 * (the CapCut/Premiere clip-fade affordance). Edits are one undo step per
 * gesture.
 */
export function FadeOverlay({
  element,
  pxPerMs,
  widthPx,
  interactive,
}: {
  element: FadeableClip;
  pxPerMs: number;
  widthPx: number;
  interactive: boolean;
}) {
  const engine = useEditor();
  const dragRef = useRef<{ edge: "in" | "out"; startClientX: number; startMs: number } | null>(
    null,
  );

  const fadeInMs = Math.min(element.fadeInMs ?? 0, element.durationMs);
  const fadeOutMs = Math.min(element.fadeOutMs ?? 0, element.durationMs);
  const fadeInPx = fadeInMs * pxPerMs;
  const fadeOutPx = fadeOutMs * pxPerMs;

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!interactive || event.button !== 0) return;
    event.stopPropagation();
    const edge = event.currentTarget.dataset.fadeEdge as "in" | "out";
    dragRef.current = {
      edge,
      startClientX: event.clientX,
      startMs: edge === "in" ? fadeInMs : fadeOutMs,
    };
    engine.beginTransaction();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Fade-in grows rightward, fade-out grows leftward.
    const deltaMs = ((event.clientX - drag.startClientX) / pxPerMs) * (drag.edge === "in" ? 1 : -1);
    const nextMs = Math.round(
      Math.max(0, Math.min(element.durationMs, drag.startMs + deltaMs)),
    );
    try {
      engine.dispatch({
        type: "updateElement",
        elementId: element.id,
        patch: drag.edge === "in" ? { fadeInMs: nextMs } : { fadeOutMs: nextMs },
      });
    } catch {
      // Element vanished mid-drag.
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    engine.endTransaction();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleClass = cn(
    "absolute top-0 z-30 size-2.5 -translate-x-1/2 -translate-y-1/3 cursor-ew-resize rounded-full",
    "bg-overlay-foreground ring-2 ring-overlay/60 transition-transform hover:scale-125",
  );

  return (
    <>
      {/* Ramp wedges: shade what the fade silences. */}
      {fadeInPx > 1 && (
        <svg
          className="pointer-events-none absolute inset-y-0 left-0 z-20 h-full"
          width={fadeInPx}
          preserveAspectRatio="none"
          viewBox="0 0 1 1"
        >
          <path d="M 0 0 L 1 0 L 0 1 Z" fill="rgba(0, 0, 0, 0.4)" />
          <path d="M 0 1 L 1 0" stroke="rgba(255, 255, 255, 0.8)" strokeWidth={0.04} fill="none" />
        </svg>
      )}
      {fadeOutPx > 1 && (
        <svg
          className="pointer-events-none absolute inset-y-0 right-0 z-20 h-full"
          width={fadeOutPx}
          preserveAspectRatio="none"
          viewBox="0 0 1 1"
        >
          <path d="M 0 0 L 1 0 L 1 1 Z" fill="rgba(0, 0, 0, 0.4)" />
          <path d="M 0 0 L 1 1" stroke="rgba(255, 255, 255, 0.8)" strokeWidth={0.04} fill="none" />
        </svg>
      )}
      {interactive && (
        <>
          <span
            title="Drag to fade audio in"
            data-fade-edge="in"
            className={handleClass}
            style={{ left: Math.min(fadeInPx, widthPx) }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <span
            title="Drag to fade audio out"
            data-fade-edge="out"
            className={handleClass}
            style={{ left: Math.max(0, widthPx - fadeOutPx) }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </>
      )}
    </>
  );
}
