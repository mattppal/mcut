"use client";

import { useState } from "react";
import { SwatchIcon, Trash2Icon } from "@/lib/hugeicons";
import { useEditor, useProject } from "@mcut/react";
import { createPresetId, listPresets } from "@mcut/timeline";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The ONE preset affordance, shared by every inspector section that opts in
 * (Figma styles, loosely): a swatch button on the section header that lists
 * the project's presets for this surface, applies one on click, and saves
 * the current values under a name. Presets are pure data on the project
 * (`project.presets`); this menu never interprets `values` — the section
 * captures them in `getValues` and writes them back in `onApply`, so the
 * same component serves element styles and multicam slot styles alike.
 */
export function PresetMenu({
  kind,
  getValues,
  onApply,
  className,
}: {
  /** Preset namespace this section saves into (e.g. "effects", "slot-style"). */
  kind: string;
  /** Capture the section's current values for "Save preset". */
  getValues: () => Record<string, unknown>;
  /** Write a preset's values back through the section's normal commands. */
  onApply: (values: Record<string, unknown>) => void;
  className?: string;
}) {
  const engine = useEditor();
  const project = useProject();
  const presets = listPresets(project, kind);
  const [open, setOpen] = useState(false);

  const save = () => {
    const name = window.prompt("Save the current settings as a preset:");
    if (!name?.trim()) return;
    try {
      engine.dispatch({
        type: "savePreset",
        preset: { id: createPresetId(), name: name.trim(), kind, values: getValues() },
      });
      toast.success(`"${name.trim()}" saved — apply it from any matching section`);
    } catch {
      toast.error("Could not save the preset");
    }
  };

  const apply = (values: Record<string, unknown>) => {
    try {
      onApply(values);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the preset");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn("size-5 text-muted-foreground", className)}
            title="Presets"
          />
        }
      >
        <SwatchIcon />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        {presets.length === 0 && (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">
            No presets yet — save the current settings to reuse them on any matching section.
          </p>
        )}
        {presets.map((preset) => (
          <div key={preset.id} className="group/preset flex items-center gap-1">
            <button
              type="button"
              className="h-6 flex-1 truncate rounded-sm px-2 text-left text-xs hover:bg-foreground/5"
              onClick={() => apply(preset.values)}
            >
              {preset.name}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover/preset:opacity-100"
              title={`Delete "${preset.name}"`}
              onClick={() => engine.dispatch({ type: "removePreset", presetId: preset.id })}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <div className={cn(presets.length > 0 && "mt-1 border-t pt-1")}>
          <button
            type="button"
            className="h-6 w-full rounded-sm px-2 text-left text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            onClick={save}
          >
            Save current as preset…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
