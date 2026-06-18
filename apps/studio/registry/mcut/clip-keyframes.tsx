"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, useProject } from "@mcut/react";
import {
  animatableProperties,
  getEffectiveVolume,
  getKeyframes,
  hasKeyframes,
  type AnimatableProperty,
  type Project,
  type TimelineElement,
} from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { useEditorUI } from "./editor-ui";
import { formatTimecode } from "./format";
import { collectSnapTargets, snapTime, type SnapTarget } from "./timeline-snap";

const SNAP_PX = 8;
export const KEYFRAME_DRAG_THRESHOLD_PX = 3;

/** Unique, sorted element-local keyframe times across every armed property. */
function aggregatedTimes(element: TimelineElement): number[] {
  const times = new Set<number>();
  for (const property of animatableProperties(element)) {
    for (const keyframe of getKeyframes(element, property)) times.add(keyframe.timeMs);
  }
  return [...times].sort((a, b) => a - b);
}

/** Animated properties that have a keyframe exactly at `timeMs`. */
export function keyframePropertiesAt(
  element: TimelineElement,
  timeMs: number,
): AnimatableProperty[] {
  return animatableProperties(element).filter((property) =>
    getKeyframes(element, property).some((keyframe) => keyframe.timeMs === timeMs),
  );
}

export function isKeyframeDragPastThreshold(startClientX: number, clientX: number): boolean {
  return Math.abs(clientX - startClientX) >= KEYFRAME_DRAG_THRESHOLD_PX;
}

export function isKeyframeSnapEnabled(snapEnabled: boolean, altKey: boolean): boolean {
  return snapEnabled && !altKey;
}

export function resolveKeyframeClickGesture({
  moved,
  startedAltKey,
  endedAltKey,
}: {
  moved: boolean;
  startedAltKey: boolean;
  endedAltKey: boolean;
}): "delete" | "seek" | "none" {
  if (moved) return "none";
  return startedAltKey || endedAltKey ? "delete" : "seek";
}

/**
 * Clamp a grouped keyframe move so every property in the group avoids its
 * neighboring keyframes. The moving key itself is identified by `originTimeMs`.
 */
export function clampKeyframeDragTarget(
  element: TimelineElement,
  properties: readonly AnimatableProperty[],
  originTimeMs: number,
  desiredTimeMs: number,
): number {
  let min = 0;
  let max = element.durationMs;
  for (const property of properties) {
    const track = getKeyframes(element, property);
    const previous = [...track].reverse().find((keyframe) => keyframe.timeMs < originTimeMs);
    const next = track.find((keyframe) => keyframe.timeMs > originTimeMs);
    if (previous) min = Math.max(min, previous.timeMs + 1);
    if (next) max = Math.min(max, next.timeMs - 1);
  }
  if (min > max) return originTimeMs;
  return Math.max(min, Math.min(max, Math.round(desiredTimeMs)));
}

export function canMoveKeyframeGroup(
  element: TimelineElement,
  properties: readonly AnimatableProperty[],
  fromTimeMs: number,
  toTimeMs: number,
): boolean {
  return properties.every((property) => {
    const track = getKeyframes(element, property);
    return (
      track.some((keyframe) => keyframe.timeMs === fromTimeMs) &&
      (toTimeMs === fromTimeMs || !track.some((keyframe) => keyframe.timeMs === toTimeMs))
    );
  });
}

function keyframeSnapTargets(
  project: Project,
  playheadMs: number,
  element: TimelineElement,
): SnapTarget[] {
  const selectedClipEdges: SnapTarget[] = [
    { timeMs: element.startMs, kind: "clip-start" },
    { timeMs: element.startMs + element.durationMs, kind: "clip-end" },
  ];
  return [
    ...collectSnapTargets(project, playheadMs, new Set([element.id])),
    ...selectedClipEdges,
  ].sort((a, b) => a.timeMs - b.timeMs);
}

function keyframeMarkerRows(element: TimelineElement): Array<{ timeMs: number; key: string }> {
  const signatureCounts = new Map<string, number>();
  return aggregatedTimes(element).map((timeMs) => {
    const signature = keyframePropertiesAt(element, timeMs).join("|");
    const ordinal = signatureCounts.get(signature) ?? 0;
    signatureCounts.set(signature, ordinal + 1);
    return { timeMs, key: `keyframe-${signature}-${ordinal}` };
  });
}

/**
 * CapCut-style keyframe diamonds on a selected clip. Drag retimes (snapping
 * to clip edges and the playhead), Option-drag bypasses snapping, click seeks
 * to the keyframe, and Option-click deletes it across all properties.
 */
export function KeyframeMarkers({
  element,
  pxPerMs,
}: {
  element: TimelineElement;
  pxPerMs: number;
}) {
  const engine = useEditor();
  const project = useProject();
  const { snapEnabled, setSnapGuideMs } = useEditorUI();
  const dragRef = useRef<{
    originTimeMs: number;
    currentTimeMs: number;
    startClientX: number;
    startedAltKey: boolean;
    moved: boolean;
    transactionStarted: boolean;
    properties: AnimatableProperty[];
  } | null>(null);
  const [dragBadge, setDragBadge] = useState<{
    timeMs: number;
    noSnap: boolean;
  } | null>(null);

  const removeAt = (timeMs: number) => {
    engine.transact(() => {
      for (const property of animatableProperties(element)) {
        if (getKeyframes(element, property).some((k) => k.timeMs === timeMs)) {
          try {
            engine.dispatch({ type: "removeKeyframe", elementId: element.id, property, timeMs });
          } catch {
            // Already gone.
          }
        }
      }
    });
  };

  const onPointerDown = (timeMs: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const properties = keyframePropertiesAt(element, timeMs);
    if (properties.length === 0) return;
    dragRef.current = {
      originTimeMs: timeMs,
      currentTimeMs: timeMs,
      startClientX: event.clientX,
      startedAltKey: event.altKey,
      moved: false,
      transactionStarted: false,
      properties,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaPx = event.clientX - drag.startClientX;
    if (!drag.moved && !isKeyframeDragPastThreshold(drag.startClientX, event.clientX)) return;
    if (!drag.transactionStarted) {
      drag.transactionStarted = true;
      engine.beginTransaction();
    }
    drag.moved = true;

    const desiredLocal = drag.originTimeMs + deltaPx / pxPerMs;
    const live = engine.project.tracks.flatMap((t) => t.elements).find((e) => e.id === element.id);
    if (!live) return;
    const snapping = isKeyframeSnapEnabled(snapEnabled, event.altKey);
    const clampedDesired = clampKeyframeDragTarget(
      live,
      drag.properties,
      drag.originTimeMs,
      desiredLocal,
    );
    const snapped = snapTime(
      element.startMs + clampedDesired,
      keyframeSnapTargets(engine.project, engine.playback.state.currentTimeMs, element),
      SNAP_PX / pxPerMs,
      { enabled: snapping },
    );
    const toTimeMs = clampKeyframeDragTarget(
      live,
      drag.properties,
      drag.originTimeMs,
      snapped.ms - element.startMs,
    );

    setSnapGuideMs(snapping ? snapped.guideMs : null);
    setDragBadge({ timeMs: toTimeMs, noSnap: event.altKey });
    if (toTimeMs === drag.currentTimeMs) return;
    if (!canMoveKeyframeGroup(live, drag.properties, drag.currentTimeMs, toTimeMs)) return;

    for (const property of drag.properties) {
      try {
        engine.dispatch({
          type: "moveKeyframe",
          elementId: element.id,
          property,
          fromTimeMs: drag.currentTimeMs,
          toTimeMs,
        });
      } catch {
        return;
      }
    }
    drag.currentTimeMs = toTimeMs;
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.transactionStarted) engine.endTransaction();
    setSnapGuideMs(null);
    setDragBadge(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled) return;

    const gesture = resolveKeyframeClickGesture({
      moved: drag.moved,
      startedAltKey: drag.startedAltKey,
      endedAltKey: event.altKey,
    });
    if (gesture === "delete") removeAt(drag.originTimeMs);
    if (gesture === "seek") engine.seek(element.startMs + drag.originTimeMs);
  };

  void project; // markers re-render with project changes via parent

  return (
    <>
      {keyframeMarkerRows(element).map(({ timeMs, key }) => (
        <button
          key={key}
          type="button"
          className="absolute bottom-0 z-30 flex h-3.5 w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center"
          style={{ left: timeMs * pxPerMs }}
          title="Keyframe - drag to retime, Option-drag no snap, Option-click delete"
          onPointerDown={onPointerDown(timeMs)}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishPointer(event)}
          onPointerCancel={(event) => finishPointer(event, true)}
        >
          <span className="size-1.5 rotate-45 border border-overlay/60 bg-overlay-foreground shadow-sm" />
        </button>
      ))}
      {dragBadge && (
        <span
          className="pointer-events-none absolute bottom-4 z-40 flex -translate-x-1/2 items-center gap-1 rounded-sm bg-overlay/80 px-1.5 py-0.5 font-mono text-2xs text-overlay-foreground shadow-sm"
          style={{ left: dragBadge.timeMs * pxPerMs }}
        >
          {formatTimecode(element.startMs + dragBadge.timeMs)}
          {dragBadge.noSnap && <span className="font-sans text-2xs uppercase">No snap</span>}
        </span>
      )}
    </>
  );
}

/**
 * Premiere-style volume rubber band on audio clips: the line shows the
 * resolved volume curve; drag vertically to set volume (the nearest keyframe
 * when armed), ⌘/Ctrl-click to add a keyframe on the band.
 */
export function VolumeBand({
  element,
  widthPx,
  heightPx,
  interactive,
}: {
  element: TimelineElement & { type: "audio" | "video" };
  widthPx: number;
  heightPx: number;
  interactive: boolean;
}) {
  const engine = useEditor();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ targetTimeMs: number | null } | null>(null);
  const armed = hasKeyframes(element, "volume");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(1, Math.round(widthPx));
    const height = Math.max(1, Math.round(heightPx));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "rgba(103, 232, 249, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 3) {
      const timelineMs = element.startMs + (x / width) * element.durationMs;
      // Effective volume (keyframes × fades): the band shows what plays.
      const volume = Math.max(0, Math.min(2, getEffectiveVolume(element, timelineMs)));
      const y = height - (volume / 2) * height;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [element, widthPx, heightPx]);

  const valueFromY = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = 1 - (event.clientY - rect.top) / rect.height;
    return Math.round(Math.max(0, Math.min(2, ratio * 2)) * 100) / 100;
  };

  const localTimeFromX = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(element.durationMs, Math.round(ratio * element.durationMs)));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.stopPropagation();
    engine.beginTransaction();
    if (event.metaKey || event.ctrlKey) {
      // ⌘-click: add a keyframe on the band (arms the property).
      const timeMs = localTimeFromX(event);
      try {
        engine.dispatch({
          type: "setKeyframe",
          elementId: element.id,
          property: "volume",
          timeMs,
          value: valueFromY(event),
        });
      } catch {
        // Element vanished.
      }
      dragRef.current = { targetTimeMs: timeMs };
    } else if (armed) {
      // Drag the nearest keyframe's value (time stays put).
      const timeMs = localTimeFromX(event);
      const track = getKeyframes(element, "volume");
      const nearest = track.reduce((best, k) =>
        Math.abs(k.timeMs - timeMs) < Math.abs(best.timeMs - timeMs) ? k : best,
      );
      dragRef.current = { targetTimeMs: nearest.timeMs };
    } else {
      dragRef.current = { targetTimeMs: null }; // static volume drag
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const value = valueFromY(event);
    try {
      if (drag.targetTimeMs === null) {
        engine.dispatch({ type: "updateElement", elementId: element.id, patch: { volume: value } });
      } else {
        engine.dispatch({
          type: "setKeyframe",
          elementId: element.id,
          property: "volume",
          timeMs: drag.targetTimeMs,
          value,
        });
      }
    } catch {
      // Ignore mid-drag races.
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    engine.endTransaction();
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className={cn(
        "absolute inset-0 z-20",
        interactive ? "cursor-ns-resize" : "pointer-events-none",
      )}
      title={
        interactive
          ? "Volume band — drag to set, ⌘-click to add a keyframe"
          : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />
    </div>
  );
}
