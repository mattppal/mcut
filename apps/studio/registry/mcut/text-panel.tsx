"use client";

import { useDraggable } from "@dnd-kit/core";
import { useEditor } from "@mcut/react";
import { cn } from "@/lib/utils";
import {
  elementForTextPreset,
  insertElementAtPlayhead,
  TEXT_PRESETS,
  type TextPreset,
} from "./editor-actions";
import type { EditorDragData } from "./editor-dnd";

function PresetCard({ preset }: { preset: TextPreset }) {
  const engine = useEditor();
  const dragData: EditorDragData = { kind: "text-preset", preset };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `text-preset-${preset.name}`,
    data: dragData,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "flex aspect-video cursor-grab touch-none flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-overlay/60 p-2 transition-shadow hover:ring-1 hover:ring-primary/40",
        isDragging && "opacity-40",
      )}
      onClick={() => insertElementAtPlayhead(engine, elementForTextPreset(engine, preset))}
      title={`${preset.name} — drag to the timeline or click to add at the playhead`}
    >
      <span
        className="max-w-full truncate leading-none"
        style={{
          color: preset.style.color ?? "#ffffff",
          fontWeight: preset.style.fontWeight ?? 700,
          fontSize: Math.max(11, (preset.style.fontSize ?? 96) / 7),
          backgroundColor: preset.style.backgroundColor,
          padding: preset.style.backgroundColor ? "0.1em 0.35em" : undefined,
          borderRadius: preset.style.backgroundColor ? 4 : undefined,
        }}
      >
        {preset.text}
      </span>
      <span className="text-2xs text-muted-foreground">{preset.name}</span>
    </button>
  );
}

/** Text tab: preset titles you can click or drag into the composition. */
export function TextPanel({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-1.5 p-2", className)}>
      {TEXT_PRESETS.map((preset) => (
        <PresetCard key={preset.name} preset={preset} />
      ))}
    </div>
  );
}
