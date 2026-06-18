"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "@mcut/react";
import {
  getKeyframes,
  type AnimatableProperty,
  type Easing,
  type Keyframe,
  type TimelineElement,
} from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEditorState } from "@mcut/react";
import { getElementLocation, type ElementId } from "@mcut/timeline";

/**
 * The graph editor: value-vs-time for one property of one clip, AE-style.
 * Keyframes are draggable points (drag retimes + revalues); each segment's
 * easing is a cubic-bezier whose two handles you drag directly — mcut's
 * easing IS `cubicBezier`, so the mapping is 1:1, and the evaluator accepts
 * y outside 0..1, which is exactly how Overshoot/Anticipate work. A curve
 * library applies named beziers per segment (⌥-click: all segments).
 */

const W = 280;
const H = 150;
const PAD = 18;

/** Named curves (the Flow-plugin idea). x values stay in 0..1; y overshoots. */
export const CURVE_LIBRARY: Array<{ name: string; bezier: [number, number, number, number] }> = [
  { name: "Linear", bezier: [0.25, 0.25, 0.75, 0.75] },
  { name: "Smooth", bezier: [0.42, 0, 0.58, 1] },
  { name: "Snap", bezier: [0.7, 0, 0.2, 1] },
  { name: "Settle", bezier: [0.2, 0.8, 0.2, 1] },
  { name: "Overshoot", bezier: [0.34, 1.56, 0.64, 1] },
  { name: "Anticipate", bezier: [0.36, -0.36, 0.66, 1] },
];

function easingToBezier(easing: Easing | undefined): [number, number, number, number] {
  if (!easing || easing === "linear") return [0.25, 0.25, 0.75, 0.75];
  if (easing === "hold") return [0, 0, 1, 0]; // drawn as a step; handles hidden
  if (easing === "easeIn") return [0.42, 0, 1, 1];
  if (easing === "easeOut") return [0, 0, 0.58, 1];
  if (easing === "easeInOut") return [0.42, 0, 0.58, 1];
  return easing.cubicBezier;
}

interface Scale {
  toX: (timeMs: number) => number;
  toY: (value: number) => number;
  fromX: (x: number) => number;
  fromY: (y: number) => number;
}

function makeScale(track: readonly Keyframe[]): Scale {
  const t0 = track[0]!.timeMs;
  const t1 = Math.max(track[track.length - 1]!.timeMs, t0 + 1);
  const values = track.map((k) => k.value);
  let v0 = Math.min(...values);
  let v1 = Math.max(...values);
  if (v1 - v0 < 1e-6) {
    v0 -= 1;
    v1 += 1;
  }
  // Headroom for overshoot handles.
  const pad = (v1 - v0) * 0.25;
  v0 -= pad;
  v1 += pad;
  return {
    toX: (t) => PAD + ((t - t0) / (t1 - t0)) * (W - PAD * 2),
    toY: (v) => H - PAD - ((v - v0) / (v1 - v0)) * (H - PAD * 2),
    fromX: (x) => t0 + ((x - PAD) / (W - PAD * 2)) * (t1 - t0),
    fromY: (y) => v0 + ((H - PAD - y) / (H - PAD * 2)) * (v1 - v0),
  };
}

export function EasingGraph({
  element,
  property,
}: {
  element: TimelineElement;
  property: AnimatableProperty;
}) {
  const engine = useEditor();
  const track = getKeyframes(element, property);
  const [segment, setSegment] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<
    | { kind: "key"; index: number; fromMs: number }
    | { kind: "handle"; which: 1 | 2 }
    | null
  >(null);

  if (track.length < 2) {
    return (
      <p className="p-2 text-xs text-muted-foreground">
        Add at least two keyframes to edit the curve.
      </p>
    );
  }

  const scale = makeScale(track);
  const seg = Math.min(segment, track.length - 2);
  const from = track[seg]!;
  const to = track[seg + 1]!;
  const [bx1, by1, bx2, by2] = easingToBezier(from.easing);
  const isHold = from.easing === "hold";

  // Segment bezier control points in graph space.
  const cp = (bx: number, by: number) => ({
    x: scale.toX(from.timeMs + bx * (to.timeMs - from.timeMs)),
    y: scale.toY(from.value + by * (to.value - from.value)),
  });
  const p1 = cp(bx1, by1);
  const p2 = cp(bx2, by2);

  const pointer = (event: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const dispatch = (command: Record<string, unknown> & { type: string }) => {
    try {
      engine.dispatch(command);
    } catch {
      // Collision (duplicate time): keep last good state.
    }
  };

  const setSegmentBezier = (bezier: [number, number, number, number]) => {
    dispatch({
      type: "setKeyframeEasing",
      elementId: element.id,
      property,
      timeMs: from.timeMs,
      easing: { cubicBezier: bezier },
    });
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = pointer(event);
    if (drag.kind === "key") {
      const keyframe = track[drag.index]!;
      const toMs = Math.round(scale.fromX(x));
      const value = Math.round(scale.fromY(y) * 1000) / 1000;
      dispatch({
        type: "setKeyframe",
        elementId: element.id,
        property,
        timeMs: drag.fromMs,
        value,
        ...(keyframe.easing !== undefined ? { easing: keyframe.easing } : {}),
      });
      if (drag.index !== 0 && toMs !== drag.fromMs) {
        const prev = track[drag.index - 1];
        const next = track[drag.index + 1];
        const clamped = Math.max(
          prev ? prev.timeMs + 1 : 0,
          Math.min(toMs, next ? next.timeMs - 1 : element.durationMs),
        );
        dispatch({
          type: "moveKeyframe",
          elementId: element.id,
          property,
          fromTimeMs: drag.fromMs,
          toTimeMs: clamped,
        });
        drag.fromMs = clamped;
      }
    } else {
      // Handle drag: x clamps to the segment (bezier x must be 0..1); y is
      // free — beyond the segment's value range = overshoot.
      const span = to.timeMs - from.timeMs;
      const bx = Math.max(0, Math.min(1, (scale.fromX(x) - from.timeMs) / span));
      const vSpan = to.value - from.value;
      const by = vSpan === 0 ? 0 : (scale.fromY(y) - from.value) / vSpan;
      const next: [number, number, number, number] =
        drag.which === 1 ? [bx, by, bx2, by2] : [bx1, by1, bx, by];
      setSegmentBezier(next.map((n) => Math.round(n * 100) / 100) as typeof next);
    }
  };

  const endDrag = (event: ReactPointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    engine.endTransaction();
    (event.currentTarget as Element).releasePointerCapture(event.pointerId);
  };

  // Full curve path: per-segment cubics in graph space.
  const path = track
    .slice(0, -1)
    .map((k, i) => {
      const n = track[i + 1]!;
      const [x1, y1, x2, y2] = easingToBezier(k.easing);
      const a = { x: scale.toX(k.timeMs), y: scale.toY(k.value) };
      const b = { x: scale.toX(n.timeMs), y: scale.toY(n.value) };
      if (k.easing === "hold") {
        return `M ${a.x} ${a.y} H ${b.x - 0.01} M ${b.x} ${b.y}`;
      }
      const c1 = {
        x: scale.toX(k.timeMs + x1 * (n.timeMs - k.timeMs)),
        y: scale.toY(k.value + y1 * (n.value - k.value)),
      };
      const c2 = {
        x: scale.toX(k.timeMs + x2 * (n.timeMs - k.timeMs)),
        y: scale.toY(k.value + y2 * (n.value - k.value)),
      };
      return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className="touch-none rounded-lg bg-foreground/[0.04]"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* midline */}
        <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="currentColor" opacity={0.08} />
        <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth={1.75} />
        {/* selected-segment handles */}
        {!isHold && (
          <>
            <line x1={scale.toX(from.timeMs)} y1={scale.toY(from.value)} x2={p1.x} y2={p1.y} stroke="currentColor" opacity={0.35} />
            <line x1={scale.toX(to.timeMs)} y1={scale.toY(to.value)} x2={p2.x} y2={p2.y} stroke="currentColor" opacity={0.35} />
            {([{ p: p1, which: 1 }, { p: p2, which: 2 }] as const).map(({ p, which }) => (
              <circle
                key={which}
                cx={p.x}
                cy={p.y}
                r={4.5}
                className="cursor-grab fill-card stroke-primary"
                strokeWidth={1.5}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  dragRef.current = { kind: "handle", which };
                  engine.beginTransaction();
                  (event.currentTarget as Element).setPointerCapture(event.pointerId);
                }}
              />
            ))}
          </>
        )}
        {/* keyframes */}
        {track.map((k, i) => (
          <rect
            key={k.timeMs}
            x={scale.toX(k.timeMs) - 4}
            y={scale.toY(k.value) - 4}
            width={8}
            height={8}
            transform={`rotate(45 ${scale.toX(k.timeMs)} ${scale.toY(k.value)})`}
            className={cn(
              "cursor-grab stroke-card",
              i === seg || i === seg + 1 ? "fill-primary" : "fill-muted-foreground",
            )}
            strokeWidth={1}
            onPointerDown={(event) => {
              event.stopPropagation();
              setSegment(Math.min(i, track.length - 2));
              dragRef.current = { kind: "key", index: i, fromMs: k.timeMs };
              engine.beginTransaction();
              (event.currentTarget as Element).setPointerCapture(event.pointerId);
            }}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-1">
        {CURVE_LIBRARY.map((curve) => (
          <button
            key={curve.name}
            type="button"
            title={`${curve.name} — click: this segment · ⌥-click: every segment`}
            className="flex flex-col items-center gap-0.5 rounded-md px-1.5 py-1 hover:bg-foreground/5"
            onClick={(event) => {
              if (event.altKey) {
                engine.transact(() => {
                  for (const k of track.slice(0, -1)) {
                    dispatch({
                      type: "setKeyframeEasing",
                      elementId: element.id,
                      property,
                      timeMs: k.timeMs,
                      easing: { cubicBezier: curve.bezier },
                    });
                  }
                });
              } else {
                setSegmentBezier(curve.bezier);
              }
            }}
          >
            <CurveSparkline bezier={curve.bezier} />
            <span className="text-2xs text-muted-foreground">{curve.name}</span>
          </button>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground">
        Drag diamonds to retime/revalue · drag the round handles to shape the curve (above the
        range = overshoot) · segment {seg + 1}/{track.length - 1}
      </p>
    </div>
  );
}

function CurveSparkline({ bezier: [x1, y1, x2, y2] }: { bezier: [number, number, number, number] }) {
  const sw = 30;
  const sh = 18;
  const sx = (v: number) => 2 + v * (sw - 4);
  const sy = (v: number) => sh - 3 - v * (sh - 6);
  return (
    <svg width={sw} height={sh} className="text-primary">
      <path
        d={`M ${sx(0)} ${sy(0)} C ${sx(x1)} ${sy(y1)} ${sx(x2)} ${sy(y2)} ${sx(1)} ${sy(1)}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
      />
    </svg>
  );
}

/** Popover entry: the ∿ curve button next to a property's keyframe controls. */
export function EasingEditorButton({
  element,
  property,
}: {
  element: TimelineElement;
  property: AnimatableProperty;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open curve editor"
            title="Curve editor (graph)"
          />
        }
      >
        <span className="font-mono text-xs">∿</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto gap-2 p-3">
        <EasingGraph element={element} property={property} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Listens for "mcut:open-curve-editor" (fired from the keyframe easing menu)
 * and shows the graph in a dialog. Mount once in the shell.
 */
export function CurveEditorHost() {
  const [target, setTarget] = useState<{ elementId: ElementId; property: AnimatableProperty } | null>(
    null,
  );
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        elementId: ElementId;
        property: AnimatableProperty;
      };
      setTarget(detail);
    };
    window.addEventListener("mcut:open-curve-editor", onOpen);
    return () => window.removeEventListener("mcut:open-curve-editor", onOpen);
  }, []);

  const element = useEditorState((s) =>
    target ? getElementLocation(s.project, target.elementId)?.element : undefined,
  );

  return (
    <Dialog open={Boolean(target && element)} onOpenChange={(open) => !open && setTarget(null)}>
      <DialogContent className="w-auto max-w-none">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Curve editor — <span className="font-mono text-xs">{target?.property}</span>
          </DialogTitle>
        </DialogHeader>
        {target && element && <EasingGraph element={element} property={target.property} />}
      </DialogContent>
    </Dialog>
  );
}
