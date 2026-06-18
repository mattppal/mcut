"use client";

import { DEFAULT_SHADOW, type Shadow, type Stroke } from "@mcut/timeline";
import { Switch } from "@/components/ui/switch";
import { ColorField, FieldRow, NumberField } from "./inspector-fields";

/**
 * Appearance rows for the shared style primitives (timeline style.ts) —
 * written ONCE and rendered by every surface that carries the primitive:
 * text glyphs, media frames (video/image), and multicam layout slots. Same
 * rows everywhere is what makes a "style" preset portable across them.
 */

/** Corner radius as a fraction of the short edge, shown as 0–50%. */
export function RadiusRow({
  value,
  onCommit,
}: {
  /** 0..0.5 */
  value: number;
  onCommit: (value: number) => void;
}) {
  return (
    <NumberField
      label="Radius"
      value={Math.round(value * 100)}
      min={0}
      max={50}
      unit="%"
      scrubPerPx={0.25}
      onCommit={(pct) => onCommit(pct / 100)}
    />
  );
}

/** Border/outline: width (0 removes) + color. */
export function StrokeFields({
  value,
  onCommit,
  label = "Border",
  defaultColor = "#ffffff",
  max = 200,
}: {
  value: Stroke | undefined;
  onCommit: (stroke: Stroke | undefined) => void;
  label?: string;
  defaultColor?: string;
  max?: number;
}) {
  return (
    <>
      <NumberField
        label={label}
        value={value?.width ?? 0}
        min={0}
        max={max}
        unit="px"
        scrubPerPx={0.25}
        onCommit={(width) =>
          onCommit(width > 0 ? { color: value?.color ?? defaultColor, width } : undefined)
        }
      />
      {value && (
        <ColorField
          label={label}
          value={value.color}
          onCommit={(color) => onCommit({ ...value, color })}
        />
      )}
    </>
  );
}

/** Drop shadow: switch + color/blur/offsets when on. */
export function ShadowFields({
  value,
  onCommit,
}: {
  value: Shadow | undefined;
  onCommit: (shadow: Shadow | undefined) => void;
}) {
  return (
    <>
      <FieldRow label="Shadow">
        <Switch
          checked={value !== undefined}
          onCheckedChange={(on) => onCommit(on ? { ...DEFAULT_SHADOW } : undefined)}
        />
      </FieldRow>
      {value && (
        <>
          <ColorField
            label="Shadow"
            value={value.color}
            onCommit={(color) => onCommit({ ...value, color })}
          />
          <NumberField
            label="Blur"
            value={value.blur}
            min={0}
            max={300}
            unit="px"
            scrubPerPx={0.5}
            onCommit={(blur) => onCommit({ ...value, blur })}
          />
          <NumberField
            label="Offset X"
            value={value.offsetX}
            min={-300}
            max={300}
            unit="px"
            scrubPerPx={0.5}
            onCommit={(offsetX) => onCommit({ ...value, offsetX })}
          />
          <NumberField
            label="Offset Y"
            value={value.offsetY}
            min={-300}
            max={300}
            unit="px"
            scrubPerPx={0.5}
            onCommit={(offsetY) => onCommit({ ...value, offsetY })}
          />
        </>
      )}
    </>
  );
}

/**
 * The "style" preset payload every surface saves/applies (tolerantly: each
 * surface keeps the keys it understands and ignores the rest, so a PiP look
 * saved on a slot lands on a clip and vice versa).
 */
export interface StylePresetValues {
  cornerRadius?: number;
  stroke?: Stroke | null;
  /** Elements store the full shadow; slots store a boolean. */
  shadow?: Shadow | boolean | null;
  fit?: "cover" | "contain";
}

export function readStylePreset(values: Record<string, unknown>): StylePresetValues {
  const out: StylePresetValues = {};
  if (typeof values.cornerRadius === "number") {
    out.cornerRadius = Math.min(0.5, Math.max(0, values.cornerRadius));
  }
  const stroke = values.stroke as { color?: unknown; width?: unknown } | null | undefined;
  if (stroke === null) out.stroke = null;
  else if (stroke && typeof stroke.color === "string" && typeof stroke.width === "number" && stroke.width > 0) {
    out.stroke = { color: stroke.color, width: stroke.width };
  }
  const shadow = values.shadow as
    | { color?: unknown; blur?: unknown; offsetX?: unknown; offsetY?: unknown }
    | boolean
    | null
    | undefined;
  if (shadow === null || typeof shadow === "boolean") out.shadow = shadow;
  else if (
    shadow &&
    typeof shadow.color === "string" &&
    typeof shadow.blur === "number" &&
    typeof shadow.offsetX === "number" &&
    typeof shadow.offsetY === "number"
  ) {
    out.shadow = {
      color: shadow.color,
      blur: shadow.blur,
      offsetX: shadow.offsetX,
      offsetY: shadow.offsetY,
    };
  }
  if (values.fit === "cover" || values.fit === "contain") out.fit = values.fit;
  return out;
}
