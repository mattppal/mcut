"use client";

import { toast } from "sonner";
import { SparklesIcon } from "@/lib/hugeicons";
import { useEditor, useSelectedElement } from "@mcut/react";
import {
  ANIMATION_PRESET_CATEGORIES,
  animatableProperties,
  captureZoomPreset,
  type AnimationPreset,
  type ZoomPreset,
} from "@mcut/timeline";
import { Button } from "@/components/ui/button";
import { EmptyState, PanelSectionLabel } from "./editor-primitives";
import { removeTemplate, saveTemplate, useTemplates } from "./template-store";
import { cn } from "@/lib/utils";
import { applyStudioAnimationPreset } from "./animation-presets";
import { STUDIO_ZOOM_PRESETS } from "./zoom-presets";

const CATEGORY_LABELS: Record<keyof typeof ANIMATION_PRESET_CATEGORIES, string> = {
  in: "In",
  out: "Out",
  combo: "Emphasis",
};

const PRESET_GLYPHS: Record<AnimationPreset, string> = {
  "fade-in": "◐",
  "slide-in": "↑",
  "pop-in": "✦",
  "scale-in": "◎",
  "zoom-in": "⊕",
  "whip-in": "≫",
  "blur-in": "░",
  "fade-out": "◑",
  "slide-out": "↓",
  "pop-out": "✧",
  "zoom-out": "⊖",
  "whip-out": "≪",
  "blur-out": "▒",
  "ken-burns": "⛶",
  "punch-zoom": "◉",
  pulse: "♥",
  breathe: "◯",
  float: "~",
  sway: "∿",
  shake: "≈",
};

const PRESET_HINTS: Record<AnimationPreset, string> = {
  "fade-in": "Opacity rise on a decelerating curve",
  "slide-in": "Gentle directional rise with a long expo settle",
  "pop-in": "Scale up with a soft ~10% overshoot",
  "scale-in": "Settle down from oversized — cinematic title entrance",
  "zoom-in": "Subtle push toward camera under a fade",
  "whip-in": "Fast directional throw (enables motion blur)",
  "blur-in": "Blur-to-sharp reveal",
  "fade-out": "Accelerating fade",
  "slide-out": "Directional exit on an emphasized-accelerate curve",
  "pop-out": "Small grow (anticipation), then shrink away",
  "zoom-out": "Recede from camera under a fade",
  "whip-out": "Fast directional throw out (enables motion blur)",
  "blur-out": "Sharp-to-blur dissolve",
  "ken-burns": "Slow filmic zoom and drift across the clip",
  "punch-zoom": "Snap to a tighter framing and hold (enables motion blur)",
  pulse: "Rhythmic ±5% scale beat",
  breathe: "Barely-there ±2% scale breathing",
  float: "Slow vertical bob",
  sway: "Slow ±1.5° rotation drift",
  shake: "Damped impact wobble",
};

function prettyName(preset: AnimationPreset): string {
  return preset.replace(/-/g, " ");
}

/**
 * Saved zooms: built-ins plus the user's captured presets. Click applies at
 * the playhead (relative to the clip's current framing); Save captures the
 * selected clip's scale/position keyframes as a reusable preset.
 */
function ZoomsSection() {
  const engine = useEditor();
  const selected = useSelectedElement();
  const userZooms = useTemplates<ZoomPreset>("zoom");
  const element = selected?.element;
  const zoomable =
    element &&
    (element.type === "video" ||
      element.type === "image" ||
      element.type === "text" ||
      element.type === "multicam");

  const apply = (preset: ZoomPreset) => {
    if (!element || !zoomable) return;
    const playheadMs = engine.playback.state.currentTimeMs;
    const atMs = Math.round(
      Math.max(0, Math.min(playheadMs - element.startMs, element.durationMs - preset.durationMs)),
    );
    try {
      engine.dispatch({ type: "applyZoomPreset", elementId: element.id, preset, atMs });
      toast.success(`${preset.name} applied at the playhead`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the zoom");
    }
  };

  const save = () => {
    if (!element) return;
    const name = window.prompt("Name this zoom", "My zoom");
    if (!name) return;
    const preset = captureZoomPreset(element, name);
    if (!preset) {
      toast.error("Add scale/position keyframes first, then save them as a zoom.");
      return;
    }
    saveTemplate("zoom", name, preset);
    toast.success(`Saved "${name}" — it now applies to any clip in one click`);
  };

  const zooms: Array<{ preset: ZoomPreset; templateId?: string }> = [
    ...STUDIO_ZOOM_PRESETS.map((preset) => ({ preset })),
    ...userZooms.map((t) => ({ preset: t.payload, templateId: t.id })),
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center px-1">
        <PanelSectionLabel className="flex-1">Zooms</PanelSectionLabel>
        <Button variant="ghost" size="xs" disabled={!element} onClick={save} title="Capture the selected clip's scale/position keyframes as a reusable zoom">
          Save zoom
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {zooms.map(({ preset, templateId }, i) => (
          <button
            key={templateId ?? `builtin-${i}`}
            type="button"
            disabled={!zoomable}
            className="group/zoom relative flex aspect-[2/1] flex-col items-center justify-center gap-0.5 rounded-lg bg-foreground/[0.05] transition-colors hover:bg-primary/10 disabled:opacity-50"
            onClick={() => apply(preset)}
            title={`${preset.name} · ${(preset.durationMs / 1000).toFixed(2)}s — applies at the playhead`}
          >
            <ZoomSparkline preset={preset} />
            <span className="text-2xs">{preset.name}</span>
            {templateId && (
              <span
                role="button"
                tabIndex={-1}
                className="absolute top-0.5 right-1 hidden text-2xs text-muted-foreground group-hover/zoom:block hover:text-destructive"
                title="Delete saved zoom"
                onClick={(event) => {
                  event.stopPropagation();
                  removeTemplate(templateId);
                }}
              >
                ✕
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tiny scale-over-time curve preview. */
function ZoomSparkline({ preset }: { preset: ZoomPreset }) {
  const track = preset.tracks["scale.x"] ?? preset.tracks["scale.y"];
  if (!track) return <span className="text-lg leading-none text-primary">⊕</span>;
  const values = track.map((k) => k.value);
  const min = Math.min(...values, 1);
  const max = Math.max(...values, 1);
  const span = Math.max(0.0001, max - min);
  const points = track
    .map((k) => `${(k.t * 44 + 2).toFixed(1)},${(14 - ((k.value - min) / span) * 12 + 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg width="48" height="16" viewBox="0 0 48 16" className="text-primary">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * CapCut-style In / Out / Emphasis animation gallery. Presets EXPAND into
 * ordinary keyframes on the selected element — open the inspector afterwards
 * and every diamond is there to edit.
 */
export function AnimationsPanel({ className }: { className?: string }) {
  const engine = useEditor();
  const selected = useSelectedElement();
  const element = selected?.element;
  const animatable = element ? animatableProperties(element).length > 0 : false;

  const apply = (preset: AnimationPreset) => {
    if (!element) return;
    try {
      applyStudioAnimationPreset(engine, element, preset, engine.playback.state.currentTimeMs);
      toast.success(`${prettyName(preset)} applied — keyframes are editable in the inspector`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the preset");
    }
  };

  if (!element || !animatable) {
    return (
      <EmptyState
        className={className}
        icon={SparklesIcon}
        description={
          element
            ? "This element has no animatable properties."
            : "Select a clip to apply an animation. Presets expand into editable keyframes."
        }
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-3 p-2", className)}>
      <ZoomsSection />
      {(Object.keys(ANIMATION_PRESET_CATEGORIES) as Array<keyof typeof ANIMATION_PRESET_CATEGORIES>).map(
        (category) => (
          <div key={category} className="flex flex-col gap-1.5">
            <PanelSectionLabel className="px-1">{CATEGORY_LABELS[category]}</PanelSectionLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {ANIMATION_PRESET_CATEGORIES[category].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  data-preset={preset}
                  className="flex aspect-[2/1] flex-col items-center justify-center gap-1 rounded-lg border bg-overlay/40 transition-colors hover:border-primary/60 hover:bg-primary/10"
                  onClick={() => apply(preset)}
                  title={`${PRESET_HINTS[preset]} — expands to editable keyframes`}
                >
                  <span className="text-lg leading-none text-primary">{PRESET_GLYPHS[preset]}</span>
                  <span className="text-2xs capitalize">{prettyName(preset)}</span>
                </button>
              ))}
            </div>
          </div>
        ),
      )}
      <p className="px-1 text-2xs leading-relaxed text-muted-foreground">
        Presets write real keyframes — fine-tune them with the ◆ controls in the inspector.
      </p>
    </div>
  );
}
