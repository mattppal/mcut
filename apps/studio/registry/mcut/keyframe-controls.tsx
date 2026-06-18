"use client";

import { ChevronRightIcon, XIcon } from "@/lib/hugeicons";
import { useEditor, usePlayback } from "@mcut/react";
import {
  getKeyframes,
  getStaticValue,
  hasKeyframes,
  isOnKeyframe,
  type AnimatableProperty,
  type Easing,
  type TimelineElement,
} from "@mcut/timeline";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const EASING_PRESETS: Array<{ label: string; value: Easing }> = [
  { label: "Linear", value: "linear" },
  { label: "Ease in", value: "easeIn" },
  { label: "Ease out", value: "easeOut" },
  { label: "Ease in-out", value: "easeInOut" },
  { label: "Hold", value: "hold" },
];

/** Element-local playhead, clamped into the clip. */
export function localPlayheadMs(element: TimelineElement, timelineMs: number): number {
  return Math.max(0, Math.min(element.durationMs, Math.round(timelineMs - element.startMs)));
}

/** A CapCut-style keyframe diamond (rotated square). */
export function Diamond({
  filled,
  armed,
  className,
}: {
  filled: boolean;
  armed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 rotate-45 border transition-colors",
        filled
          ? "border-primary bg-primary"
          : armed
            ? "border-primary bg-transparent"
            : "border-muted-foreground/70 bg-transparent",
        className,
      )}
    />
  );
}

/**
 * Premiere's Effect-Controls keyframe cluster for one property:
 * ◀ (previous) ◆ (toggle at playhead; first tap arms the stopwatch)
 * ▶ (next), an easing menu when sitting on a keyframe, and a stopwatch-off
 * (clear) affordance when armed.
 */
export function KeyframeRowControls({
  element,
  property,
}: {
  element: TimelineElement;
  property: AnimatableProperty;
}) {
  const engine = useEditor();
  const armed = hasKeyframes(element, property);
  const playheadMs = usePlayback((s) => Math.round(s.currentTimeMs));
  const localMs = localPlayheadMs(element, playheadMs);
  const track = getKeyframes(element, property);
  const onKeyframe = armed && isOnKeyframe(element, property, playheadMs);
  const previous = [...track].reverse().find((k) => k.timeMs < localMs);
  const next = track.find((k) => k.timeMs > localMs);
  const currentKeyframe = track.find((k) => Math.abs(k.timeMs - localMs) <= 1);

  const toggle = () => {
    try {
      if (onKeyframe) {
        if (track.length === 1) {
          // Removing the last keyframe = stopwatch off; keep the current value.
          const value = currentKeyframe?.value;
          engine.transact(() => {
            engine.dispatch({ type: "clearKeyframes", elementId: element.id, property });
            if (value !== undefined) applyStatic(value);
          });
        } else {
          engine.dispatch({
            type: "removeKeyframe",
            elementId: element.id,
            property,
            timeMs: currentKeyframe!.timeMs,
          });
        }
      } else {
        const value = armed
          ? // Adding between keyframes: freeze the interpolated value.
            undefined
          : getStaticValue(element, property);
        engine.dispatch({
          type: "setKeyframe",
          elementId: element.id,
          property,
          timeMs: localMs,
          value: value ?? interpolatedNow(),
        });
      }
    } catch {
      // Element vanished or invalid time: ignore.
    }
  };

  const interpolatedNow = () => {
    // getAnimatedValue without importing it twice — track is non-empty here.
    const before = [...track].reverse().find((k) => k.timeMs <= localMs);
    const after = track.find((k) => k.timeMs >= localMs);
    if (!before) return after!.value;
    if (!after || after === before) return before.value;
    const t = (localMs - before.timeMs) / (after.timeMs - before.timeMs);
    return before.value + (after.value - before.value) * t;
  };

  const applyStatic = (value: number) => {
    const patch: Record<string, unknown> = {};
    if (property === "opacity") patch.opacity = Math.min(1, Math.max(0, value));
    else if (property === "volume") patch.volume = Math.min(2, Math.max(0, value));
    // Animated blur has no static counterpart on the element — its resting
    // value is 0 and persistent blur lives in the effects stack instead.
    else if (property === "blur") return;
    else if (property === "letterSpacing") {
      if (element.type !== "text") return;
      patch.style = { ...element.style, letterSpacing: value };
    }
    else if ("transform" in element) {
      const key = { "position.x": "x", "position.y": "y", "scale.x": "scaleX", "scale.y": "scaleY", rotation: "rotation" }[property];
      patch.transform = { ...element.transform, [key as string]: value };
    }
    engine.dispatch({ type: "updateElement", elementId: element.id, patch });
  };

  const seekTo = (timeMs: number) => engine.seek(element.startMs + timeMs);

  const disarm = () => {
    if (!window.confirm(`Delete all ${track.length} ${property} keyframe(s)?`)) return;
    engine.dispatch({ type: "clearKeyframes", elementId: element.id, property });
  };

  return (
    <span className="group/kf flex shrink-0 items-center gap-px">
      <button
        type="button"
        className="flex size-4 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25"
        disabled={!previous}
        title="Previous keyframe"
        onClick={() => previous && seekTo(previous.timeMs)}
      >
        <ChevronRightIcon className="size-3 rotate-180" />
      </button>
      <button
        type="button"
        className="flex size-4 items-center justify-center"
        title={
          onKeyframe
            ? "Remove keyframe at playhead"
            : armed
              ? "Add keyframe at playhead"
              : "Arm keyframes (stopwatch on) — adds one at the playhead"
        }
        onClick={toggle}
      >
        <Diamond filled={onKeyframe} armed={armed} />
      </button>
      <button
        type="button"
        className="flex size-4 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25"
        disabled={!next}
        title="Next keyframe"
        onClick={() => next && seekTo(next.timeMs)}
      >
        <ChevronRightIcon className="size-3" />
      </button>
      {armed && onKeyframe && currentKeyframe && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex h-4 items-center px-0.5 font-mono text-2xs text-muted-foreground hover:text-foreground"
                title="Interpolation toward the next keyframe"
              />
            }
          >
            ∿
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Interpolation</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("mcut:open-curve-editor", {
                    detail: { elementId: element.id, property },
                  }),
                );
              }}
            >
              Curve editor…
              <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">∿</span>
            </DropdownMenuItem>
            {EASING_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                onClick={() =>
                  engine.dispatch({
                    type: "setKeyframeEasing",
                    elementId: element.id,
                    property,
                    timeMs: currentKeyframe.timeMs,
                    easing: preset.value,
                  })
                }
              >
                {preset.label}
                {(currentKeyframe.easing ?? "linear") === preset.value && (
                  <span className="ml-auto pl-3 text-primary">•</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {armed && (
        <button
          type="button"
          className="flex size-4 items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover/kf:opacity-100 hover:text-destructive"
          title="Stopwatch off — delete all keyframes for this property"
          onClick={disarm}
        >
          <XIcon className="size-2.5" />
        </button>
      )}
    </span>
  );
}
