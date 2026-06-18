"use client";

// Effects: the effect stack (drag to reorder), blend mode, and the keyframable blur.

import { useState } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, Trash2Icon, XIcon } from "@/lib/hugeicons";
import { useEditor, usePlayback } from "@mcut/react";
import {
  getEffectType,
  listEffectTypes,
  getAnimatedValue,
  hasKeyframes,
  type Effect,
  type TimelineElement,
} from "@mcut/timeline";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyframeRowControls, localPlayheadMs } from "./keyframe-controls";
import { FieldRow, NumberField, Section } from "./inspector-fields";
import { PresetMenu } from "./preset-menu";

const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
] as const;

function EffectRow({
  elementId,
  effect,
  index,
}: {
  elementId: string;
  effect: Effect;
  index: number;
}) {
  const engine = useEditor();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(index),
  });
  const dispatch = (command: Record<string, unknown> & { type: string }) => {
    try {
      engine.dispatch(command);
    } catch (error) {
      // "Nothing happened" reads as a bug — say why the edit was refused.
      toast.error(error instanceof Error ? error.message : "Edit failed");
    }
  };
  // The effect type declares its own primary scrubbable param.
  const param = getEffectType(effect.type)?.param;
  const value = param ? ((effect as unknown as Record<string, number>)[param.key] ?? 0) : 0;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-1.5", isDragging && "relative z-10 opacity-80")}
    >
      <button
        type="button"
        title="Drag to reorder — the stack applies top to bottom"
        className="shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3" />
      </button>
      <button
        type="button"
        title={effect.enabled ? "Click to disable" : "Click to enable"}
        className={cn(
          "w-14 shrink-0 truncate text-left text-xs capitalize",
          effect.enabled ? "text-foreground" : "text-muted-foreground line-through",
        )}
        onClick={() =>
          dispatch({ type: "updateEffect", elementId, index, patch: { enabled: !effect.enabled } })
        }
      >
        {effect.type.replace("-", " ")}
      </button>
      {param ? (
        <NumberField
          className="flex-1"
          value={Math.round(value * 100) / 100}
          min={param.min}
          max={param.max}
          step={(param.max - param.min) / 100}
          scrubPerPx={(param.max - param.min) / 200}
          {...(param.unit ? { unit: param.unit } : {})}
          onCommit={(next) =>
            dispatch({ type: "updateEffect", elementId, index, patch: { [param.key]: next } })
          }
        />
      ) : (
        <span className="flex-1 truncate font-mono text-2xs text-muted-foreground">
          {effect.type === "css" ? effect.filter : ""}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        title="Remove effect"
        onClick={() => dispatch({ type: "removeEffect", elementId, index })}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

export function EffectsSection({ element }: { element: TimelineElement }) {
  const engine = useEditor();
  const [adding, setAdding] = useState(false);
  const effects = ("effects" in element ? element.effects : undefined) ?? [];
  const blendMode = ("blendMode" in element ? element.blendMode : undefined) ?? "normal";
  // The `blur` fixed-effect property: keyframable blur on top of the static
  // stack (blur-in/out reveals). Committing a value keys it at the playhead.
  const blurArmed = hasKeyframes(element, "blur");
  const playheadMs = usePlayback((s) => (blurArmed ? Math.round(s.currentTimeMs) : -1));
  const nowMs = playheadMs >= 0 ? playheadMs : Math.round(engine.playback.state.currentTimeMs);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  // Whole-stack preset: the effects list plus blend mode, applied through
  // updateElement so the merged element re-validates (bad data just toasts).
  const applyEffectsPreset = (values: Record<string, unknown>) => {
    const patch: Record<string, unknown> = {};
    if (Array.isArray(values.effects)) patch.effects = values.effects;
    if ("blendMode" in values) patch.blendMode = values.blendMode ?? undefined;
    engine.dispatch({ type: "updateElement", elementId: element.id, patch });
  };
  // Stack order is z-order for filters: drag rows to re-apply in a new order.
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    try {
      engine.dispatch({
        type: "reorderEffect",
        elementId: element.id,
        fromIndex: Number(active.id),
        toIndex: Number(over.id),
      });
    } catch {
      // Element vanished mid-drag.
    }
  };
  return (
    <Section
      title="Effects"
      defaultOpen={effects.length > 0}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground"
            title="Add effect"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
          </Button>
          <PresetMenu
            kind="effects"
            getValues={() => ({
              effects,
              blendMode: blendMode === "normal" ? null : blendMode,
            })}
            onApply={applyEffectsPreset}
          />
        </>
      }
    >
      <DndContext
        id={`mcut-effects-${element.id}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={effects.map((_, index) => String(index))}
          strategy={verticalListSortingStrategy}
        >
          {effects.map((effect, index) => (
            <EffectRow
              key={`${effect.type}-${index}`}
              elementId={element.id}
              effect={effect}
              index={index}
            />
          ))}
        </SortableContext>
      </DndContext>
      {adding && (
        <FieldRow label="New">
          <Select
            value={null}
            onValueChange={(type) => {
              setAdding(false);
              if (!type) return;
              try {
                engine.dispatch({ type: "addEffect", elementId: element.id, effect: { type } });
              } catch {
                // Element vanished mid-edit.
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full flex-1 text-xs">
              <SelectValue placeholder="Choose an effect…" />
            </SelectTrigger>
            <SelectContent>
              {listEffectTypes()
                .map((e) => e.type)
                .filter((type) => type !== "css")
                .map((type) => (
                  <SelectItem key={type} value={type} className="text-xs capitalize">
                    {type.replace("-", " ")}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon-xs" title="Cancel" onClick={() => setAdding(false)}>
            <XIcon />
          </Button>
        </FieldRow>
      )}
      <NumberField
        label="Blur"
        value={Math.round((blurArmed ? getAnimatedValue(element, "blur", nowMs) : 0) * 10) / 10}
        min={0}
        max={200}
        unit="px"
        scrubPerPx={0.5}
        onCommit={(radius) => {
          try {
            engine.dispatch({
              type: "setKeyframe",
              elementId: element.id,
              property: "blur",
              timeMs: localPlayheadMs(element, nowMs),
              value: radius,
            });
          } catch {
            // Element vanished mid-edit.
          }
        }}
        controls={<KeyframeRowControls element={element} property="blur" />}
      />
      <FieldRow label="Blend">
        <Select
          value={blendMode}
          onValueChange={(mode) =>
            engine.dispatch({
              type: "setBlendMode",
              elementId: element.id,
              blendMode: !mode || mode === "normal" ? null : mode,
            })
          }
        >
          <SelectTrigger size="sm" className="w-full flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLEND_MODES.map((mode) => (
              <SelectItem key={mode} value={mode} className="text-xs capitalize">
                {mode.replace("-", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
    </Section>
  );
}
