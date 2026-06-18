"use client";

// Inspector for the layout slot being edited on the canvas (multicam mode).

import { useEditor, useProject } from "@mcut/react";
import {
  createLayoutId,
  type Layout,
  type LayoutSlot,
} from "@mcut/timeline";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useEditorUI } from "./editor-ui";
import { roundRect, safeAreaRect, saveLayoutSlot } from "./layout-slot-editor";
import { ChoiceRow, FieldRow, NumberField, Section } from "./inspector-fields";
import { FrameFields, type FrameTarget } from "./frame-section";
import { PresetMenu } from "./preset-menu";
import { RadiusRow, readStylePreset, StrokeFields } from "./style-fields";

/** Aspect chips for quick crops: keep the slot's center and pixel width. */
export const SLOT_ASPECTS: ReadonlyArray<readonly [label: string, ratio: number]> = [
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
];

/**
 * Inspector for the layout slot being edited on the canvas (multicam mode).
 * The canvas does direct manipulation (move / resize / crop-pan); everything
 * with a value lives here, in the same controls as element properties.
 */
export function LayoutSlotInspector({ layout, className }: { layout: Layout; className?: string }) {
  const engine = useEditor();
  const project = useProject();
  const { editingSlotIndex, setEditingSlotIndex } = useEditorUI();
  const W = project.width;
  const H = project.height;
  const index =
    editingSlotIndex !== null && layout.slots[editingSlotIndex] !== undefined
      ? editingSlotIndex
      : null;
  const slot = index !== null ? layout.slots[index]! : null;
  const safe = safeAreaRect(W, H);

  const save = (patch: Partial<LayoutSlot>, options?: { history?: boolean }) => {
    if (index !== null) saveLayoutSlot(engine, layout, index, patch, options);
  };
  const saveRect = (rect: LayoutSlot["rect"], options?: { history?: boolean }) =>
    save({ rect: roundRect(rect) }, options);

  const applyAspect = (ratio: number) => {
    if (!slot) return;
    // Hold the center and the pixel width; derive the height (shrink to fit).
    let w = slot.rect.w;
    let h = (slot.rect.w * W) / ratio / H;
    if (h > 1) {
      w /= h;
      h = 1;
    }
    const cx = slot.rect.x + slot.rect.w / 2;
    const cy = slot.rect.y + slot.rect.h / 2;
    saveRect({ x: cx - w / 2, y: cy - h / 2, w, h });
  };

  // The shared frame editor drives the slot through px-rect reads/writes;
  // normalized storage stays an adapter detail.
  const slotFrame: FrameTarget | null =
    slot === null
      ? null
      : {
          canvas: { width: W, height: H },
          safe: { x: safe.x * W, y: safe.y * H, width: safe.w * W, height: safe.h * H },
          rect: {
            x: slot.rect.x * W,
            y: slot.rect.y * H,
            width: slot.rect.w * W,
            height: slot.rect.h * H,
          },
          minSize: 16,
          setRect: (patch) => {
            const next = { ...slot.rect };
            if (patch.x !== undefined) next.x = patch.x / W;
            if (patch.y !== undefined) next.y = patch.y / H;
            if (patch.width !== undefined) next.w = patch.width / W;
            if (patch.height !== undefined) next.h = patch.height / H;
            saveRect(next);
          },
        };

  const saveAsPreset = () => {
    const name = window.prompt("Save this layout as a new preset:", `${layout.name} copy`);
    if (!name?.trim()) return;
    try {
      engine.dispatch({
        type: "saveLayout",
        layout: { ...layout, id: createLayoutId(), name: name.trim() },
      });
      toast.success(`"${name.trim()}" added to the layout bank`);
    } catch {
      toast.error("Could not save the preset");
    }
  };

  return (
    <div className={cn("flex flex-col gap-1 p-3", className)}>
      <div className="flex items-center gap-2 pb-1">
        <span className="flex-1 truncate text-xs font-semibold" title={layout.name}>
          Layout · {layout.name}
        </span>
        <Button variant="secondary" size="xs" onClick={saveAsPreset}>
          Save as preset
        </Button>
      </div>

      <Section title="Slots">
        {layout.slots.map((s, i) => (
          <button
            key={`${s.source}-${i}`}
            type="button"
            className={cn(
              "flex items-center justify-between rounded-md border px-2 py-1 text-xs capitalize",
              i === index
                ? "border-primary bg-primary/10 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
            onClick={() => setEditingSlotIndex(i)}
          >
            {s.source}
            <span className="text-2xs text-muted-foreground normal-case">
              {layout.slots.length > 1 && i === layout.slots.length - 1
                ? "top"
                : layout.slots.length > 1 && i === 0
                  ? "bottom"
                  : ""}
            </span>
          </button>
        ))}
        {slot === null && (
          <p className="text-2xs text-muted-foreground">
            Click a slot above or on the canvas to style it.
          </p>
        )}
      </Section>

      {slot && index !== null && slotFrame && (
        <>
          <Section title="Frame">
            <FrameFields target={slotFrame} />
            <FieldRow
              label="Aspect"
              title="Crop the slot to an aspect (keeps its center and width)"
            >
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-1">
                {SLOT_ASPECTS.map(([label, ratio]) => (
                  <Button
                    key={label}
                    size="xs"
                    variant="outline"
                    className="min-w-0 px-1"
                    onClick={() => applyAspect(ratio)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </FieldRow>
            <FieldRow label="Fill">
              <Button
                size="xs"
                variant="outline"
                className="flex-1"
                title="Fit the slot to the safe area"
                onClick={() => saveRect(safe)}
              >
                Safe area
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="flex-1"
                title="Fill the whole canvas"
                onClick={() => saveRect({ x: 0, y: 0, w: 1, h: 1 })}
              >
                Screen
              </Button>
            </FieldRow>
          </Section>

          <Section
            title="Style"
            actions={
              <PresetMenu
                kind="style"
                getValues={() => ({
                  fit: slot.fit,
                  cornerRadius: slot.cornerRadius,
                  shadow: slot.shadow,
                  stroke: slot.stroke ?? null,
                })}
                onApply={(values) => {
                  // Tolerant apply: slots keep the keys they understand; a
                  // full element shadow lands as the slot's boolean look.
                  const preset = readStylePreset(values);
                  const patch: Partial<LayoutSlot> = {};
                  if (preset.fit) patch.fit = preset.fit;
                  if (preset.cornerRadius !== undefined) patch.cornerRadius = preset.cornerRadius;
                  if (preset.stroke !== undefined) patch.stroke = preset.stroke ?? undefined;
                  if (preset.shadow !== undefined) {
                    patch.shadow =
                      typeof preset.shadow === "boolean" ? preset.shadow : preset.shadow !== null;
                  }
                  save(patch);
                }}
              />
            }
          >
            <ChoiceRow
              label="Fit"
              value={slot.fit}
              options={["cover", "contain"] as const}
              onCommit={(fit) => save({ fit })}
            />
            <RadiusRow
              value={slot.cornerRadius}
              onCommit={(cornerRadius) => save({ cornerRadius })}
            />
            <StrokeFields
              value={slot.stroke}
              onCommit={(stroke) => save({ stroke })}
            />
            <FieldRow label="Shadow">
              <Switch
                aria-label="Shadow"
                checked={slot.shadow}
                onCheckedChange={(shadow) => save({ shadow })}
              />
            </FieldRow>
          </Section>

          {slot.fit === "cover" && (
            <Section title="Crop" onReset={() => save({ focus: { x: 0.5, y: 0.5 } })}>
              <NumberField
                label="Focus X"
                value={Math.round((slot.focus?.x ?? 0.5) * 100)}
                min={0}
                max={100}
                unit="%"
                scrubPerPx={0.5}
                onCommit={(pct) => save({ focus: { y: slot.focus?.y ?? 0.5, x: pct / 100 } })}
              />
              <NumberField
                label="Focus Y"
                value={Math.round((slot.focus?.y ?? 0.5) * 100)}
                min={0}
                max={100}
                unit="%"
                scrubPerPx={0.5}
                onCommit={(pct) => save({ focus: { x: slot.focus?.x ?? 0.5, y: pct / 100 } })}
              />
              <p className="text-2xs text-muted-foreground">
                Or double-click the slot on the canvas and drag to pan the source inside the
                frame.
              </p>
            </Section>
          )}

          <p className="text-2xs text-muted-foreground">
            On the canvas: drag to move (snaps to the safe area, center, and other slots — hold ⌘
            to disable), corners resize with the aspect locked (Shift frees it), arrows nudge by
            1px.
          </p>
        </>
      )}
    </div>
  );
}
