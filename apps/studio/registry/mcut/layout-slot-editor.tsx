"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, useEditorState } from "@mcut/react";
import type { EditorEngine, Layout, LayoutSlot } from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEditorUI } from "./editor-ui";
import { clamp, clamp01 } from "./math";
import { findTargetMulticam } from "./multicam-ui";

/**
 * On-canvas direct manipulation for a multicam layout, Figma-style: slots
 * are draggable boxes with eight resize handles (corners keep the aspect,
 * Shift frees it; edges stretch one axis), drags snap to the safe area /
 * canvas center / sibling slots with guide lines (⌘ disables), arrows nudge
 * by a pixel, and double-clicking a cover slot enters crop mode where
 * dragging pans the source inside the frame. Everything with a value — fit,
 * radius, shadow, aspect, exact position — lives in the inspector
 * (LayoutSlotInspector in properties-layout-slot.tsx), keyed off the shared
 * editingSlotIndex edit state. Every edit dispatches saveLayout, so the bank
 * tiles and program output restyle live.
 */

const MIN_SIZE = 0.05;
const CLICK_SLOP_PX = 4;
const SNAP_PX = 8;

/** Safe-area margin: 5% of the canvas short edge (uniform in pixels). */
export const SAFE_MARGIN = 0.05;

/** The safe-area rect in normalized canvas coordinates. */
export function safeAreaRect(width: number, height: number): LayoutSlot["rect"] {
  const margin = SAFE_MARGIN * Math.min(width, height);
  return {
    x: margin / width,
    y: margin / height,
    w: 1 - (2 * margin) / width,
    h: 1 - (2 * margin) / height,
  };
}

export function roundRect(rect: LayoutSlot["rect"]): LayoutSlot["rect"] {
  return {
    x: Math.round(rect.x * 1000) / 1000,
    y: Math.round(rect.y * 1000) / 1000,
    w: Math.round(rect.w * 1000) / 1000,
    h: Math.round(rect.h * 1000) / 1000,
  };
}

/** Patch one slot of a layout (shared with the inspector). */
export function saveLayoutSlot(
  engine: EditorEngine,
  layout: Layout,
  index: number,
  patch: Partial<LayoutSlot>,
  options?: { history?: boolean },
): void {
  try {
    engine.dispatch(
      {
        type: "saveLayout",
        layout: {
          ...layout,
          slots: layout.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)),
        },
      },
      options,
    );
  } catch {
    // Layout vanished mid-edit.
  }
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Closest snap candidate to any of `positions` within `threshold`. */
function snapAxis(
  positions: number[],
  candidates: number[],
  threshold: number,
): { delta: number; guide: number | null } {
  let best: { delta: number; guide: number } | null = null;
  for (const position of positions) {
    for (const candidate of candidates) {
      const delta = candidate - position;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, guide: candidate };
      }
    }
  }
  return best ?? { delta: 0, guide: null };
}

/** Snap targets on one axis: canvas edges/center, safe area, sibling slots. */
function axisCandidates(
  layout: Layout,
  skipIndex: number,
  safe: LayoutSlot["rect"],
  axis: "x" | "y",
): number[] {
  const candidates =
    axis === "x" ? [0, safe.x, 0.5, safe.x + safe.w, 1] : [0, safe.y, 0.5, safe.y + safe.h, 1];
  layout.slots.forEach((slot, i) => {
    if (i === skipIndex) return;
    const start = axis === "x" ? slot.rect.x : slot.rect.y;
    const length = axis === "x" ? slot.rect.w : slot.rect.h;
    candidates.push(start, start + length / 2, start + length);
  });
  return candidates;
}

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: ReadonlyArray<{ id: HandleId; x: number; y: number; cursor: string }> = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
];

interface Guides {
  x: number | null;
  y: number | null;
  /** True while a drag is live (shows the safe-area outline). */
  active: boolean;
}

const NO_GUIDES: Guides = { x: null, y: null, active: false };

function SlotBox({
  layout,
  slot,
  index,
  selected,
  cropping,
  sourceSize,
  onSelect,
  onToggleCrop,
  setGuides,
}: {
  layout: Layout;
  slot: LayoutSlot;
  index: number;
  selected: boolean;
  cropping: boolean;
  /** Natural pixel size of the source filling this slot (for crop panning). */
  sourceSize: { width: number; height: number } | null;
  onSelect: (index: number) => void;
  onToggleCrop: (index: number) => void;
  setGuides: (guides: Guides) => void;
}) {
  const engine = useEditor();
  const dragRef = useRef<{
    mode: "move" | "resize" | "crop";
    handle: HandleId | null;
    startX: number;
    startY: number;
    rect: LayoutSlot["rect"];
    focus: { x: number; y: number };
    /** How many container px of the source overflow the slot per axis (crop). */
    overflow: { x: number; y: number };
    container: DOMRect;
    moved: boolean;
  } | null>(null);

  const save = (patch: Partial<LayoutSlot>) => saveLayoutSlot(engine, layout, index, patch);

  const begin = (
    mode: "move" | "resize" | "crop",
    event: ReactPointerEvent<HTMLElement>,
    handle: HandleId | null = null,
  ) => {
    event.stopPropagation();
    const container = (
      event.currentTarget.closest("[data-mcut-slot-editor]") as HTMLElement
    ).getBoundingClientRect();
    const overflow = { x: 0, y: 0 };
    if (mode === "crop" && sourceSize) {
      const slotW = slot.rect.w * container.width;
      const slotH = slot.rect.h * container.height;
      const scale = Math.max(slotW / sourceSize.width, slotH / sourceSize.height);
      overflow.x = sourceSize.width * scale - slotW;
      overflow.y = sourceSize.height * scale - slotH;
    }
    dragRef.current = {
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect: slot.rect,
      focus: slot.focus ?? { x: 0.5, y: 0.5 },
      overflow,
      container,
      moved: false,
    };
    engine.beginTransaction();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = event.clientX - drag.startX;
    const dyPx = event.clientY - drag.startY;
    if (Math.hypot(dxPx, dyPx) > CLICK_SLOP_PX) drag.moved = true;
    if (!drag.moved) return;

    if (drag.mode === "crop") {
      // Dragging the content right reveals more of the source's left side,
      // so the focus moves opposite the pointer — and only where the cover
      // crop actually overflows the slot.
      const fx = drag.overflow.x > 1 ? clamp01(drag.focus.x - dxPx / drag.overflow.x) : drag.focus.x;
      const fy = drag.overflow.y > 1 ? clamp01(drag.focus.y - dyPx / drag.overflow.y) : drag.focus.y;
      save({ focus: { x: round3(fx), y: round3(fy) } });
      return;
    }

    const dx = dxPx / drag.container.width;
    const dy = dyPx / drag.container.height;
    const snapOff = event.metaKey || event.ctrlKey;
    const safe = safeAreaRect(engine.project.width, engine.project.height);
    const candidatesX = axisCandidates(layout, index, safe, "x");
    const candidatesY = axisCandidates(layout, index, safe, "y");
    const thresholdX = SNAP_PX / drag.container.width;
    const thresholdY = SNAP_PX / drag.container.height;
    const r = drag.rect;

    if (drag.mode === "move") {
      let x = clamp(r.x + dx, -0.45, 1.45 - r.w);
      let y = clamp(r.y + dy, -0.45, 1.45 - r.h);
      let guideX: number | null = null;
      let guideY: number | null = null;
      if (!snapOff) {
        const snapX = snapAxis([x, x + r.w / 2, x + r.w], candidatesX, thresholdX);
        x += snapX.delta;
        guideX = snapX.guide;
        const snapY = snapAxis([y, y + r.h / 2, y + r.h], candidatesY, thresholdY);
        y += snapY.delta;
        guideY = snapY.guide;
      }
      setGuides({ x: guideX, y: guideY, active: true });
      save({ rect: roundRect({ ...r, x, y }) });
      return;
    }

    const handle = drag.handle!;
    const corner = handle.length === 2;
    const locked = corner && !event.shiftKey;
    const dominantX = Math.abs(dxPx) >= Math.abs(dyPx);
    const right = r.x + r.w;
    const bottom = r.y + r.h;
    let w = handle.includes("e") ? r.w + dx : handle.includes("w") ? r.w - dx : r.w;
    let h = handle.includes("s") ? r.h + dy : handle.includes("n") ? r.h - dy : r.h;
    const ratio = r.w / r.h;
    if (locked) {
      if (dominantX) h = w / ratio;
      else w = h * ratio;
    }
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (!snapOff) {
      // Snap the moving edges; with the aspect locked only the dominant axis
      // snaps, then the other re-derives so the ratio survives.
      if ((!locked || dominantX) && handle.includes("e")) {
        const snap = snapAxis([r.x + w], candidatesX, thresholdX);
        w += snap.delta;
        guideX = snap.guide;
      }
      if ((!locked || dominantX) && handle.includes("w")) {
        const snap = snapAxis([right - w], candidatesX, thresholdX);
        w -= snap.delta;
        guideX = snap.guide;
      }
      if ((!locked || !dominantX) && handle.includes("s")) {
        const snap = snapAxis([r.y + h], candidatesY, thresholdY);
        h += snap.delta;
        guideY = snap.guide;
      }
      if ((!locked || !dominantX) && handle.includes("n")) {
        const snap = snapAxis([bottom - h], candidatesY, thresholdY);
        h -= snap.delta;
        guideY = snap.guide;
      }
      if (locked) {
        if (dominantX) h = w / ratio;
        else w = h * ratio;
      }
    }
    w = clamp(w, MIN_SIZE, 3);
    h = clamp(h, MIN_SIZE, 3);
    const x = handle.includes("w") ? right - w : r.x;
    const y = handle.includes("n") ? bottom - h : r.y;
    setGuides({ x: guideX, y: guideY, active: true });
    save({ rect: roundRect({ x, y, w, h }) });
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    engine.endTransaction();
    setGuides(NO_GUIDES);
    event.currentTarget.releasePointerCapture(event.pointerId);
    // A press that never moved is a click: select the slot for the inspector.
    if (!drag.moved && drag.mode !== "resize") onSelect(index);
  };

  return (
    <div
      className={cn(
        "absolute border-2 bg-primary/10 hover:bg-primary/15",
        cropping
          ? "cursor-grab border-dashed border-primary active:cursor-grabbing"
          : selected
            ? "cursor-move border-primary"
            : "cursor-move border-primary/50",
      )}
      style={{
        left: `${slot.rect.x * 100}%`,
        top: `${slot.rect.y * 100}%`,
        width: `${slot.rect.w * 100}%`,
        height: `${slot.rect.h * 100}%`,
        // Mirror the render's rounding so radius edits read on the overlay too.
        borderRadius: `${slot.cornerRadius * 100}%`,
      }}
      onPointerDown={(event) => begin(cropping ? "crop" : "move", event)}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => slot.fit === "cover" && onToggleCrop(index)}
    >
      <span className="absolute top-0.5 left-1.5 rounded-sm bg-overlay/60 px-1 text-2xs text-overlay-foreground/90 capitalize">
        {slot.source}
      </span>
      {selected &&
        !cropping &&
        HANDLES.map((handle) => (
          <span
            key={handle.id}
            data-handle={handle.id}
            className="absolute size-2.5 rounded-[2px] border border-overlay/40 bg-primary"
            style={{
              left: `${handle.x * 100}%`,
              top: `${handle.y * 100}%`,
              transform: "translate(-50%, -50%)",
              cursor: handle.cursor,
            }}
            onPointerDown={(event) => begin("resize", event, handle.id)}
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
    </div>
  );
}

/** Mounted over the preview while a layout is being edited (multicam mode). */
export function LayoutSlotEditor() {
  const engine = useEditor();
  const { editingLayoutId, setEditingLayoutId, editingSlotIndex, setEditingSlotIndex } =
    useEditorUI();
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const layout = useEditorState((s) =>
    editingLayoutId ? s.project.layouts.find((l) => l.id === editingLayoutId) : undefined,
  );
  const selectedIds = useEditorState((s) => s.selection.elementIds);
  const lastLayoutRef = useRef<string | null>(null);

  // Entering a layout opens its topmost slot (usually the PiP) in the
  // inspector, so the panel is immediately useful.
  useEffect(() => {
    if (editingLayoutId === lastLayoutRef.current) return;
    lastLayoutRef.current = editingLayoutId;
    setCropIndex(null);
    if (editingLayoutId && layout) setEditingSlotIndex(layout.slots.length - 1);
  }, [editingLayoutId, layout, setEditingSlotIndex]);

  // Esc walks out one level (crop → slot selection → editor); arrows nudge
  // the selected slot by a pixel (Shift = 10). Capture phase so the global
  // playhead/selection hotkeys don't also fire.
  useEffect(() => {
    if (!layout) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (cropIndex !== null) setCropIndex(null);
        else if (editingSlotIndex !== null) setEditingSlotIndex(null);
        else setEditingLayoutId(null);
        return;
      }
      if (!event.key.startsWith("Arrow") || editingSlotIndex === null) return;
      const slot = layout.slots[editingSlotIndex];
      if (!slot) return;
      event.preventDefault();
      event.stopPropagation();
      const px = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -px : event.key === "ArrowRight" ? px : 0;
      const dy = event.key === "ArrowUp" ? -px : event.key === "ArrowDown" ? px : 0;
      saveLayoutSlot(engine, layout, editingSlotIndex, {
        rect: roundRect({
          ...slot.rect,
          x: clamp(slot.rect.x + dx / engine.project.width, -0.45, 1.45 - slot.rect.w),
          y: clamp(slot.rect.y + dy / engine.project.height, -0.45, 1.45 - slot.rect.h),
        }),
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [engine, layout, cropIndex, editingSlotIndex, setEditingLayoutId, setEditingSlotIndex]);

  if (!layout) return null;

  // Crop panning needs the source's natural size; resolve it through the
  // multicam the bank targets (selected, else under playhead, else first).
  const target = findTargetMulticam(
    engine.project,
    selectedIds,
    engine.playback.state.currentTimeMs,
  );
  const sourceSize = (key: string) => {
    const source = target?.element.sources.find((s) => s.key === key);
    const asset = source ? engine.project.assets[source.assetId] : undefined;
    return asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null;
  };

  const safe = safeAreaRect(engine.project.width, engine.project.height);

  return (
    <div
      data-mcut-slot-editor=""
      className="absolute inset-0 z-10"
      onPointerDown={(event) => {
        // Clicking empty canvas steps out of crop mode / slot selection.
        if (event.target !== event.currentTarget) return;
        setCropIndex(null);
        setEditingSlotIndex(null);
      }}
    >
      {guides.active && (
        <div
          className="pointer-events-none absolute border border-dashed border-(--snap-guide)/50"
          style={{
            left: `${safe.x * 100}%`,
            top: `${safe.y * 100}%`,
            width: `${safe.w * 100}%`,
            height: `${safe.h * 100}%`,
          }}
        />
      )}
      {guides.x !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-(--snap-guide)"
          style={{ left: `${guides.x * 100}%` }}
        />
      )}
      {guides.y !== null && (
        <div
          className="pointer-events-none absolute inset-x-0 h-px bg-(--snap-guide)"
          style={{ top: `${guides.y * 100}%` }}
        />
      )}
      {layout.slots.map((slot, index) => (
        <SlotBox
          key={`${slot.source}-${index}`}
          layout={layout}
          slot={slot}
          index={index}
          selected={editingSlotIndex === index}
          cropping={cropIndex === index}
          sourceSize={sourceSize(slot.source)}
          onSelect={(i) => {
            setEditingSlotIndex(i);
            if (cropIndex !== null && cropIndex !== i) setCropIndex(null);
          }}
          onToggleCrop={(i) => {
            setEditingSlotIndex(i);
            setCropIndex((current) => (current === i ? null : i));
          }}
          setGuides={setGuides}
        />
      ))}
      <div className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-overlay/65 px-2 py-1">
        <span className="text-2xs text-overlay-foreground/90">
          {cropIndex !== null
            ? "Drag inside the slot to pan its crop — Esc or double-click to finish"
            : `Editing “${layout.name}” — style it in the inspector`}
        </span>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => {
            setCropIndex(null);
            setEditingSlotIndex(null);
            setEditingLayoutId(null);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
