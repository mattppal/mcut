"use client";

// The full typography stack for text elements, plus the canvas text-measurement helpers.

import { layoutTextBlock, measureWith, type SizeHelpers } from "@mcut/compositor";
import {
  type Project,
  type TextBox,
  type TextRun,
  type TextStyle,
} from "@mcut/timeline";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FontPicker } from "./font-picker";
import { closestWeight, ensureFontLoaded, findFontOption } from "./font-library";
import { ChoiceRow, ColorField, FieldRow, NumberField } from "./inspector-fields";
import { ShadowFields, StrokeFields } from "./style-fields";

const WEIGHT_LABELS: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/**
 * The full typography stack for text elements: family (font library picker),
 * weight/italic from the family's real faces, size, tracking, line height,
 * case, alignment, colors, outline, and drop shadow — the CapCut/Canva
 * table-stakes set for thumbnail text.
 */
export function TextStyleSection({
  style,
  patchStyle,
  spacing,
}: {
  style: TextStyle;
  patchStyle: (values: Record<string, unknown>) => void;
  /** Keyframe-aware Spacing row wiring (text elements; captions omit it). */
  spacing?: { value: number; onCommit: (value: number) => void; controls: React.ReactNode };
}) {
  const option = findFontOption(style.fontFamily);
  const weights = option?.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const weightItems = weights.includes(style.fontWeight)
    ? weights
    : [...weights, style.fontWeight].sort((a, b) => a - b);
  const italic = style.fontStyle === "italic";
  // Variable families expose the whole wght axis; static ones their cuts.
  const axis = option?.variableWeight;

  const setFamily = (fontFamily: string) => {
    // Keep the weight where the new family can express it: clamp onto a
    // variable axis, else snap to the nearest static face.
    const next = findFontOption(fontFamily);
    const fontWeight = next?.variableWeight
      ? Math.round(
          Math.min(next.variableWeight.max, Math.max(next.variableWeight.min, style.fontWeight)),
        )
      : next
        ? closestWeight(next.weights, style.fontWeight)
        : style.fontWeight;
    const fontStyle = italic && next && !next.hasItalic ? "normal" : style.fontStyle;
    patchStyle({ fontFamily, fontWeight, fontStyle });
  };

  const setWeight = (fontWeight: number) => {
    void ensureFontLoaded(style.fontFamily, fontWeight, italic);
    patchStyle({ fontWeight });
  };

  const italicButton = (
    <Button
      variant={italic ? "secondary" : "ghost"}
      size="icon-xs"
      title="Italic"
      onClick={() => {
        const fontStyle = italic ? "normal" : "italic";
        void ensureFontLoaded(style.fontFamily, style.fontWeight, fontStyle === "italic");
        patchStyle({ fontStyle });
      }}
    >
      <span className="font-serif text-xs italic">I</span>
    </Button>
  );

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">Font</span>
        <FontPicker
          value={style.fontFamily}
          weight={style.fontWeight}
          italic={italic}
          onSelect={setFamily}
          className="flex-1"
        />
      </div>
      {axis ? (
        // Variable font: the full weight axis, scrubbable like any number.
        <NumberField
          label="Weight"
          value={style.fontWeight}
          min={axis.min}
          max={axis.max}
          step={10}
          scrubPerPx={4}
          onCommit={(w) => setWeight(Math.round(w))}
          controls={italicButton}
        />
      ) : (
        <FieldRow label="Weight">
          <Select
            value={String(style.fontWeight)}
            onValueChange={(w) => w && setWeight(Number(w))}
          >
            <SelectTrigger size="sm" className="w-full flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weightItems.map((w) => (
                <SelectItem key={w} value={String(w)} className="text-xs">
                  {WEIGHT_LABELS[w] ?? String(w)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {italicButton}
        </FieldRow>
      )}
      <NumberField
        label="Size"
        value={style.fontSize}
        min={4}
        unit="px"
        onCommit={(fontSize) => patchStyle({ fontSize })}
      />
      <NumberField
        label="Spacing"
        value={spacing?.value ?? style.letterSpacing}
        step={0.5}
        min={-50}
        max={200}
        unit="px"
        scrubPerPx={0.25}
        onCommit={spacing?.onCommit ?? ((letterSpacing) => patchStyle({ letterSpacing }))}
        controls={spacing?.controls}
      />
      <NumberField
        label="Line"
        value={style.lineHeight}
        step={0.05}
        min={0.5}
        max={3}
        unit="x"
        scrubPerPx={0.01}
        onCommit={(lineHeight) => patchStyle({ lineHeight })}
      />
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">Case</span>
        <div className="flex flex-1 gap-1">
          {(
            [
              ["none", "—", "As typed"],
              ["uppercase", "AG", "UPPERCASE"],
              ["lowercase", "ag", "lowercase"],
            ] as const
          ).map(([transform, label, title]) => (
            <Button
              key={transform}
              size="xs"
              variant={style.textTransform === transform ? "secondary" : "ghost"}
              className="flex-1"
              title={title}
              onClick={() => patchStyle({ textTransform: transform })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <ChoiceRow
        label="Align"
        value={style.align}
        options={["left", "center", "right"] as const}
        onCommit={(align) => patchStyle({ align })}
      />
      <ColorField
        label="Color"
        value={style.color}
        onCommit={(color) => patchStyle({ color })}
      />
      <ColorField
        label="Fill"
        value={style.backgroundColor ?? "rgba(0, 0, 0, 0)"}
        onCommit={(backgroundColor) => patchStyle({ backgroundColor })}
      />
      {/* Outline + shadow are the shared style primitives — the same rows
          (and presets) media frames and layout slots use. */}
      <StrokeFields
        label="Outline"
        defaultColor="#000000"
        value={style.stroke}
        onCommit={(stroke) => patchStyle({ stroke })}
      />
      <ShadowFields value={style.shadow} onCommit={(shadow) => patchStyle({ shadow })} />
    </>
  );
}

let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  measureCanvas ??= document.createElement("canvas");
  return measureCanvas.getContext("2d");
}

function measureTextElement(text: string, style: TextStyle, box?: TextBox, runs?: readonly TextRun[]) {
  const ctx = getMeasureContext();
  if (!ctx) return null;
  const layout = layoutTextBlock(measureWith(ctx), text, style, {
    box,
    ...(runs ? { runs } : {}),
  });
  return { width: layout.width, height: layout.height };
}

export function sizeHelpersForProject(project: Project): SizeHelpers {
  return {
    getAssetSize: (assetId) => {
      const asset = project.assets[assetId];
      return asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null;
    },
    measureText: (text, style, box, runs) => measureTextElement(text, style, box, runs) ?? { width: 0, height: 0 },
  };
}
