"use client";

import { Trash2Icon } from "@/lib/hugeicons";
import { useEditor, usePlayback, useProject, useSelectedElement } from "@mcut/react";
import {
  getElementDisplaySize,
  getElementNaturalSize,
  getTransformForDisplaySize,
} from "@mcut/compositor";
import {
  DEFAULT_SHADOW,
  getElement,
  getGroupedElementIds,
  getAnimatedValue,
  getAverageSpeed,
  hasKeyframes,
  type AnimatableProperty,
  type Crop,
  type TextBox,
} from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ASPECT_PRESETS, matchesAspect } from "./aspect-presets";
import { useEditorUI } from "./editor-ui";
import { safeAreaRect } from "./layout-slot-editor";
import { FontPicker } from "./font-picker";
import { KeyframeRowControls, localPlayheadMs } from "./keyframe-controls";
import { ChoiceRow, ColorField, FieldRow, NumberField, Section } from "./inspector-fields";
import { FrameFields, type FrameRect, type FrameTarget } from "./frame-section";
import { PresetMenu } from "./preset-menu";
import { RadiusRow, readStylePreset, ShadowFields, StrokeFields } from "./style-fields";
import { EffectsSection } from "./properties-effects";
import { TransitionSection } from "./properties-transition";
import { MulticamSection } from "./properties-multicam";
import { sizeHelpersForProject, TextStyleSection } from "./properties-text";
import { LayoutSlotInspector, SLOT_ASPECTS } from "./properties-layout-slot";

function ProjectProperties() {
  const engine = useEditor();
  const project = useProject();
  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs text-muted-foreground">
        Nothing selected. Click a clip in the timeline or an element on the canvas.
      </p>
      <Section title="Project">
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Aspect</span>
          <div className="grid flex-1 grid-cols-4 gap-1">
            {ASPECT_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant={matchesAspect(project, preset) ? "secondary" : "outline"}
                size="xs"
                title={`${preset.hint} · ${preset.width}×${preset.height}`}
                onClick={() =>
                  engine.dispatch({
                    type: "updateProject",
                    width: preset.width,
                    height: preset.height,
                  })
                }
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <NumberField
          label="Width"
          value={project.width}
          min={2}
          unit="px"
          onCommit={(width) => engine.dispatch({ type: "updateProject", width: Math.round(width) })}
        />
        <NumberField
          label="Height"
          value={project.height}
          min={2}
          unit="px"
          onCommit={(height) => engine.dispatch({ type: "updateProject", height: Math.round(height) })}
        />
        <NumberField
          label="FPS"
          value={project.fps}
          min={1}
          max={120}
          onCommit={(fps) => engine.dispatch({ type: "updateProject", fps })}
        />
      </Section>
    </div>
  );
}

/**
 * The inspector: collapsible sections with scrubbable fields (drag a label
 * to adjust), sliders, and a full color picker — for the selected element,
 * or project settings when nothing is selected.
 */
export function PropertiesPanel({ className }: { className?: string }) {
  const engine = useEditor();
  const project = useProject();
  const selected = useSelectedElement();
  const { editingLayoutId, mode, setEditingTextId } = useEditorUI();
  // Re-render with the playhead only while the selection is keyframed, so the
  // inspector shows live resolved values (Premiere behavior) at no cost
  // for static elements.
  const anyArmed = selected ? hasKeyframes(selected.element) : false;
  const playheadMs = usePlayback((s) => (anyArmed ? Math.round(s.currentTimeMs) : -1));

  // Slot edit state takes over the inspector: while a layout is being edited
  // on the canvas, the panel styles its slots instead of the selection.
  const editingLayout = editingLayoutId
    ? project.layouts.find((l) => l.id === editingLayoutId)
    : undefined;
  if (editingLayout) return <LayoutSlotInspector layout={editingLayout} className={className} />;

  if (!selected) return <ProjectProperties />;
  const element = selected.element;
  const motionBlur = "motionBlur" in element ? element.motionBlur : undefined;
  const sizeHelpers = sizeHelpersForProject(project);
  const naturalSize = "transform" in element ? getElementNaturalSize(element, sizeHelpers) : null;
  const displaySize = "transform" in element ? getElementDisplaySize(element, sizeHelpers) : null;
  const timelineNowMs =
    playheadMs >= 0 ? playheadMs : Math.round(engine.playback.state.currentTimeMs);

  /** Resolved value for a row: keyframe track when armed, static otherwise. */
  const animValue = (property: AnimatableProperty, staticValue: number): number =>
    hasKeyframes(element, property)
      ? getAnimatedValue(element, property, timelineNowMs)
      : staticValue;

  /** Commit for a row: auto-key at the playhead when armed (stopwatch on). */
  const animCommit =
    (property: AnimatableProperty, staticCommit: (value: number) => void) =>
    (value: number) => {
      if (!hasKeyframes(element, property)) {
        staticCommit(value);
        return;
      }
      try {
        engine.dispatch({
          type: "setKeyframe",
          elementId: element.id,
          property,
          timeMs: localPlayheadMs(element, timelineNowMs),
          value,
        });
      } catch {
        // Element vanished mid-edit.
      }
    };

  const kfControls = (property: AnimatableProperty) => (
    <KeyframeRowControls element={element} property={property} />
  );

  const patch = (values: Record<string, unknown>, options?: { history?: boolean }) => {
    try {
      engine.dispatch({ type: "updateElement", elementId: element.id, patch: values }, options);
    } catch {
      // Invalid patch (overlap/bounds): drop it; inputs resync from state.
    }
  };
  const patchTransform = (
    values: Partial<{ x: number; y: number; scaleX: number; scaleY: number; rotation: number }>,
  ) => {
    if (!("transform" in element)) return;
    let transform = { ...element.transform, ...values };
    if (element.groupId) {
      if (values.scaleX !== undefined || values.scaleY !== undefined) {
        const sourceScale =
          values.scaleX !== undefined ? Math.abs(values.scaleX) : Math.abs(values.scaleY ?? transform.scaleY);
        transform = {
          ...transform,
          scaleX: (transform.scaleX < 0 ? -1 : 1) * sourceScale,
          scaleY: (transform.scaleY < 0 ? -1 : 1) * sourceScale,
        };
      }
      for (const id of getGroupedElementIds(project, element.id)) {
        const member = getElement(project, id);
        if (member && "transform" in member) {
          try {
            engine.dispatch({ type: "updateElement", elementId: id, patch: { transform } });
          } catch {
            // Invalid grouped member patch: continue with remaining members.
          }
        }
      }
      return;
    }
    patch({ transform });
  };
  const patchGroupedVisuals = (values: Record<string, unknown>) => {
    if (!element.groupId) {
      patch(values);
      return;
    }
    for (const id of getGroupedElementIds(project, element.id)) {
      const member = getElement(project, id);
      if (member && "transform" in member) {
        try {
          engine.dispatch({ type: "updateElement", elementId: id, patch: values });
        } catch {
          // Invalid grouped member patch: continue with remaining members.
        }
      }
    }
  };
  const patchStyle = (values: Record<string, unknown>) => {
    if (element.type !== "text" && element.type !== "caption") return;
    patch({ style: { ...element.style, ...values } });
  };
  const patchDisplaySize = (values: Partial<{ width: number; height: number }>) => {
    if (!("transform" in element) || !naturalSize) return;
    if (element.type === "text") {
      const box: TextBox = {
        width: Math.max(
          1,
          Math.round((values.width ?? displaySize?.width ?? naturalSize.width) / element.transform.scaleX),
        ),
        overflow: element.box?.overflow ?? "clip",
        ...(values.height !== undefined || element.box?.height !== undefined
          ? {
              height: Math.max(
                1,
                Math.round((values.height ?? displaySize?.height ?? naturalSize.height) / element.transform.scaleY),
              ),
            }
          : {}),
      };
      patch({ box });
      return;
    }
    patchTransform(
      getTransformForDisplaySize(element.transform, naturalSize, {
        ...(values.width !== undefined ? { width: values.width } : {}),
        ...(values.height !== undefined ? { height: values.height } : {}),
        ...(element.groupId ? { preserveAspect: true } : {}),
      }),
    );
  };
  const trim = (values: Partial<{ startMs: number; durationMs: number; trimStartMs: number }>) => {
    try {
      engine.dispatch({ type: "trimElement", elementId: element.id, ...values });
    } catch {
      // Rejected (overlap/asset bounds): inputs resync from state.
    }
  };

  /**
   * The element's frame for the shared frame editor (the same FrameFields
   * the multicam slot inspector renders): its canvas-px bounding box,
   * translated to the center-origin transform on write. Armed properties
   * auto-key at the playhead, exactly like the bare rows did.
   */
  const frameTarget: FrameTarget | null = (() => {
    if (!("transform" in element) || !naturalSize || !displaySize) return null;
    const isText = element.type === "text";
    const width = isText
      ? displaySize.width
      : naturalSize.width * Math.abs(animValue("scale.x", element.transform.scaleX));
    const height = isText
      ? displaySize.height
      : naturalSize.height * Math.abs(animValue("scale.y", element.transform.scaleY));
    const W = project.width;
    const H = project.height;
    const safe = safeAreaRect(W, H);
    return {
      canvas: { width: W, height: H },
      safe: { x: safe.x * W, y: safe.y * H, width: safe.w * W, height: safe.h * H },
      rect: {
        x: W / 2 + animValue("position.x", element.transform.x) - width / 2,
        y: H / 2 + animValue("position.y", element.transform.y) - height / 2,
        width,
        height,
      },
      setRect: (patchRect: Partial<FrameRect>) => {
        const nextWidth = patchRect.width ?? width;
        const nextHeight = patchRect.height ?? height;
        // Static transform fields batch into ONE update (sequential patches
        // would each spread the stale render-time transform); armed
        // properties key individually and never touch the static transform.
        const staticPatch: Partial<{ x: number; y: number; scaleX: number; scaleY: number }> =
          {};
        const commit = (property: AnimatableProperty, value: number, write: () => void) =>
          animCommit(property, write)(value);
        if (isText) {
          // Text width/height size the layout box, not the scale.
          if (patchRect.width !== undefined || patchRect.height !== undefined) {
            patchDisplaySize({
              ...(patchRect.width !== undefined ? { width: Math.round(nextWidth) } : {}),
              ...(patchRect.height !== undefined ? { height: Math.round(nextHeight) } : {}),
            });
          }
        } else {
          const preserveAspect = Boolean(element.groupId);
          if (preserveAspect && (patchRect.width !== undefined || patchRect.height !== undefined)) {
            const scale =
              patchRect.width !== undefined
                ? Math.max(0.001, nextWidth / naturalSize.width)
                : Math.max(0.001, nextHeight / naturalSize.height);
            const scaleX = (element.transform.scaleX < 0 ? -1 : 1) * scale;
            const scaleY = (element.transform.scaleY < 0 ? -1 : 1) * scale;
            commit("scale.x", scaleX, () => void (staticPatch.scaleX = scaleX));
            commit("scale.y", scaleY, () => void (staticPatch.scaleY = scaleY));
          } else {
            if (patchRect.width !== undefined) {
              const scaleX =
                (element.transform.scaleX < 0 ? -1 : 1) *
                Math.max(0.001, nextWidth / naturalSize.width);
              commit("scale.x", scaleX, () => void (staticPatch.scaleX = scaleX));
            }
            if (patchRect.height !== undefined) {
              const scaleY =
                (element.transform.scaleY < 0 ? -1 : 1) *
                Math.max(0.001, nextHeight / naturalSize.height);
              commit("scale.y", scaleY, () => void (staticPatch.scaleY = scaleY));
            }
          }
        }
        if (patchRect.x !== undefined) {
          const x = patchRect.x + nextWidth / 2 - W / 2;
          commit("position.x", x, () => void (staticPatch.x = x));
        }
        if (patchRect.y !== undefined) {
          const y = patchRect.y + nextHeight / 2 - H / 2;
          commit("position.y", y, () => void (staticPatch.y = y));
        }
        if (Object.keys(staticPatch).length > 0) patchTransform(staticPatch);
      },
      rotation: {
        value: animValue("rotation", element.transform.rotation),
        set: animCommit("rotation", (rotation) => patchTransform({ rotation })),
      },
      forceAspectLocked: Boolean(element.groupId && element.type !== "text"),
      controls: (field) => {
        if (field === "x") return kfControls("position.x");
        if (field === "y") return kfControls("position.y");
        if (field === "rotation") return kfControls("rotation");
        // Text W/H edit the layout box, not scale — no scale keys there.
        if (isText) return undefined;
        return kfControls(field === "width" ? "scale.x" : "scale.y");
      },
    };
  })();

  return (
    <div className={cn("flex flex-col gap-1 p-3", className)}>
      <div className="flex items-center gap-2 pb-1">
        <span className="flex-1 truncate text-xs font-semibold capitalize">{element.type}</span>
        <Button
          variant="destructive"
          size="icon-xs"
          title="Delete element"
          onClick={() => engine.dispatch({ type: "removeElement", elementId: element.id })}
        >
          <Trash2Icon />
        </Button>
      </div>

      <Section title="Timing">
        <NumberField
          label="Start"
          value={element.startMs / 1000}
          step={0.1}
          min={0}
          unit="s"
          onCommit={(s) => trim({ startMs: Math.round(s * 1000) })}
        />
        <NumberField
          label="Duration"
          value={element.durationMs / 1000}
          step={0.1}
          min={0.01}
          unit="s"
          onCommit={(s) => {
            // Edge trim, not a raw window edit: the clip's remaining content
            // stays anchored (reversed spans and speed maps included).
            try {
              engine.dispatch({
                type: "trimEdge",
                elementId: element.id,
                edge: "end",
                deltaMs: Math.round(s * 1000) - element.durationMs,
              });
            } catch {
              // Rejected (bounds/overlap): inputs resync from state.
            }
          }}
        />
        {"trimStartMs" in element && (
          <NumberField
            label="Trim in"
            value={element.trimStartMs / 1000}
            step={0.1}
            min={0}
            unit="s"
            onCommit={(s) => trim({ trimStartMs: Math.round(s * 1000) })}
          />
        )}
        {(element.type === "video" || element.type === "audio") && (
          <NumberField
            label="Speed"
            value={Math.round(getAverageSpeed(element) * 100) * (element.reversed ? -1 : 1)}
            step={5}
            min={-2000}
            max={2000}
            unit="%"
            scrubPerPx={1}
            onCommit={(pct) => {
              // Signed percentage: 100 = normal, 50 = half speed, negative
              // plays backward (preview scrubs reversed clips, audio muted;
              // export renders them exactly).
              const reversed = pct < 0;
              const speed = Math.min(20, Math.max(0.05, Math.abs(pct) / 100));
              try {
                engine.transact(() => {
                  engine.dispatch({ type: "setElementSpeed", elementId: element.id, speed });
                  if (reversed !== (element.reversed ?? false)) {
                    engine.dispatch({
                      type: "updateElement",
                      elementId: element.id,
                      patch: { reversed: reversed || undefined },
                    });
                  }
                });
              } catch {
                // Rejected (overlap after rescale): inputs resync from state.
              }
            }}
          />
        )}
      </Section>

      {"transform" in element && (
        <Section
          title={frameTarget ? "Frame" : "Motion"}
          onReset={() => patch({ transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } })}
        >
          {frameTarget ? (
            // Figma-basics frame rows, shared with the multicam slot editor.
            <FrameFields target={frameTarget} />
          ) : (
            // No natural size (multicam, unprobed media): offset semantics.
            <>
              <NumberField
                label="X"
                value={Math.round(animValue("position.x", element.transform.x) * 10) / 10}
                unit="px"
                scrubPerPx={1}
                onCommit={animCommit("position.x", (x) => patchTransform({ x }))}
                controls={kfControls("position.x")}
              />
              <NumberField
                label="Y"
                value={Math.round(animValue("position.y", element.transform.y) * 10) / 10}
                unit="px"
                scrubPerPx={1}
                onCommit={animCommit("position.y", (y) => patchTransform({ y }))}
                controls={kfControls("position.y")}
              />
              <NumberField
                label="Rotation"
                value={Math.round(animValue("rotation", element.transform.rotation) * 10) / 10}
                min={-180}
                max={180}
                unit="°"
                scrubPerPx={0.5}
                onCommit={animCommit("rotation", (rotation) => patchTransform({ rotation }))}
                controls={kfControls("rotation")}
              />
            </>
          )}
          <NumberField
            label="Scale"
            value={Math.round(animValue("scale.x", element.transform.scaleX) * 1000) / 1000}
            step={0.05}
            min={0.01}
            scrubPerPx={0.005}
            onCommit={(scale) => {
              // Uniform Scale: each axis keys independently when armed.
              animCommit("scale.x", () => patchTransform({ scaleX: scale, scaleY: scale }))(scale);
              if (hasKeyframes(element, "scale.y")) animCommit("scale.y", () => {})(scale);
            }}
            controls={kfControls("scale.x")}
          />
          <FieldRow label="Flip">
            <Button
              variant={element.transform.scaleX < 0 ? "secondary" : "outline"}
              size="xs"
              className="flex-1"
              title="Mirror horizontally"
              onClick={() => patchTransform({ scaleX: -element.transform.scaleX })}
            >
              Flip H
            </Button>
            <Button
              variant={element.transform.scaleY < 0 ? "secondary" : "outline"}
              size="xs"
              className="flex-1"
              title="Mirror vertically"
              onClick={() => patchTransform({ scaleY: -element.transform.scaleY })}
            >
              Flip V
            </Button>
          </FieldRow>
          <FieldRow
            label="Motion blur"
            title="Blur keyframed position/scale/rotation motion across a shutter window (AE layer model)"
          >
            <Switch
              checked={motionBlur?.enabled ?? false}
              onCheckedChange={(on) =>
                engine.dispatch({
                  type: "setMotionBlur",
                  elementId: element.id,
                  motionBlur: on
                    ? { enabled: true, shutterAngle: motionBlur?.shutterAngle ?? 180 }
                    : null,
                })
              }
            />
          </FieldRow>
          {motionBlur?.enabled && (
            <NumberField
              label="Shutter"
              value={motionBlur.shutterAngle}
              min={15}
              max={720}
              unit="°"
              scrubPerPx={2}
              onCommit={(shutterAngle) =>
                engine.dispatch({
                  type: "setMotionBlur",
                  elementId: element.id,
                  motionBlur: { enabled: true, shutterAngle },
                })
              }
            />
          )}
        </Section>
      )}

      {(element.type === "video" || element.type === "image") && (
        <Section
          title="Style"
          onReset={() =>
            patch({ cornerRadius: undefined, stroke: undefined, shadow: undefined })
          }
          actions={
            <PresetMenu
              kind="style"
              getValues={() => ({
                cornerRadius: element.cornerRadius ?? 0,
                stroke: element.stroke ?? null,
                shadow: element.shadow ?? null,
              })}
              onApply={(values) => {
                // Tolerant apply: a slot's boolean shadow becomes the
                // default element shadow; `fit` (slot-only) is ignored.
                const preset = readStylePreset(values);
                const patchValues: Record<string, unknown> = {};
                if (preset.cornerRadius !== undefined) patchValues.cornerRadius = preset.cornerRadius;
                if (preset.stroke !== undefined) patchValues.stroke = preset.stroke ?? undefined;
                if (preset.shadow !== undefined) {
                  patchValues.shadow =
                    preset.shadow === true
                      ? { ...DEFAULT_SHADOW }
                      : preset.shadow === false || preset.shadow === null
                        ? undefined
                        : preset.shadow;
                }
                patch(patchValues);
              }}
            />
          }
        >
          <RadiusRow
            value={element.cornerRadius ?? 0}
            onCommit={(cornerRadius) => patch({ cornerRadius: cornerRadius || undefined })}
          />
          <StrokeFields
            value={element.stroke}
            onCommit={(stroke) => patch({ stroke })}
          />
          <ShadowFields value={element.shadow} onCommit={(shadow) => patch({ shadow })} />
        </Section>
      )}

      {(element.type === "video" || element.type === "image") &&
        (() => {
          const asset = project.assets[element.assetId];
          if (!asset?.width || !asset?.height) return null;
          const srcW = asset.width;
          const srcH = asset.height;
          const crop: Crop = element.crop ?? { x: 0, y: 0, w: 1, h: 1 };
          const isGroupedMedia = Boolean(element.groupId);
          const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
          const setCrop = (next: Crop) => {
            const w = Math.min(1, Math.max(0.01, next.w));
            const h = Math.min(1, Math.max(0.01, next.h));
            const x = Math.min(Math.max(0, next.x), 1 - w);
            const y = Math.min(Math.max(0, next.y), 1 - h);
            const full = x === 0 && y === 0 && w === 1 && h === 1;
            patchGroupedVisuals({
              crop: full ? undefined : { x: round4(x), y: round4(y), w: round4(w), h: round4(h) },
            });
          };
          const setLockedCrop = (zoom: number, focusX: number, focusY: number) => {
            const size = Math.min(1, Math.max(0.01, 1 / Math.max(1, zoom)));
            const nextCrop = {
              x: (1 - size) * Math.min(1, Math.max(0, focusX)),
              y: (1 - size) * Math.min(1, Math.max(0, focusY)),
              w: size,
              h: size,
            };
            const full = nextCrop.x === 0 && nextCrop.y === 0 && nextCrop.w === 1 && nextCrop.h === 1;
            const displayWidth = displaySize?.width ?? srcW * crop.w * Math.abs(element.transform.scaleX);
            const scale = Math.max(0.001, displayWidth / (srcW * size));
            patchGroupedVisuals({
              crop: full
                ? undefined
                : {
                    x: round4(nextCrop.x),
                    y: round4(nextCrop.y),
                    w: round4(nextCrop.w),
                    h: round4(nextCrop.h),
                  },
              transform: {
                ...element.transform,
                scaleX: (element.transform.scaleX < 0 ? -1 : 1) * scale,
                scaleY: (element.transform.scaleY < 0 ? -1 : 1) * scale,
              },
            });
          };
          // Largest centered crop of the source with this frame aspect.
          const cropToAspect = (ratio: number) => {
            let w = 1;
            let h = srcW / ratio / srcH;
            if (h > 1) {
              w = (ratio * srcH) / srcW;
              h = 1;
            }
            setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
          };
          if (isGroupedMedia) {
            const size = Math.min(crop.w, crop.h);
            const zoom = 1 / Math.max(0.01, size);
            const focusX = 1 - size > 0 ? crop.x / (1 - size) : 0.5;
            const focusY = 1 - size > 0 ? crop.y / (1 - size) : 0.5;
            return (
              <Section
                title="Framing"
                defaultOpen={element.crop !== undefined}
                onReset={() => patchGroupedVisuals({ crop: undefined })}
              >
                <NumberField
                  label="Zoom"
                  value={Math.round(zoom * 100)}
                  min={100}
                  max={1000}
                  unit="%"
                  scrubPerPx={1}
                  onCommit={(pct) => setLockedCrop(pct / 100, focusX, focusY)}
                />
                <NumberField
                  label="Focus X"
                  value={Math.round(focusX * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  scrubPerPx={0.5}
                  onCommit={(pct) => setLockedCrop(zoom, pct / 100, focusY)}
                />
                <NumberField
                  label="Focus Y"
                  value={Math.round(focusY * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  scrubPerPx={0.5}
                  onCommit={(pct) => setLockedCrop(zoom, focusX, pct / 100)}
                />
              </Section>
            );
          }
          return (
            <Section
              title="Crop"
              defaultOpen={element.crop !== undefined}
              onReset={() => patch({ crop: undefined })}
            >
              <NumberField
                label="Left"
                value={Math.round(crop.x * srcW)}
                min={0}
                unit="px"
                scrubPerPx={2}
                onCommit={(px) => setCrop({ ...crop, x: px / srcW })}
              />
              <NumberField
                label="Top"
                value={Math.round(crop.y * srcH)}
                min={0}
                unit="px"
                scrubPerPx={2}
                onCommit={(px) => setCrop({ ...crop, y: px / srcH })}
              />
              <NumberField
                label="Width"
                value={Math.round(crop.w * srcW)}
                min={16}
                max={srcW}
                unit="px"
                scrubPerPx={2}
                onCommit={(px) => setCrop({ ...crop, w: px / srcW })}
              />
              <NumberField
                label="Height"
                value={Math.round(crop.h * srcH)}
                min={16}
                max={srcH}
                unit="px"
                scrubPerPx={2}
                onCommit={(px) => setCrop({ ...crop, h: px / srcH })}
              />
              <FieldRow label="Aspect" title="Largest centered crop with this shape">
                <div className="grid min-w-0 flex-1 grid-cols-3 gap-1">
                  {SLOT_ASPECTS.map(([label, ratio]) => (
                    <Button
                      key={label}
                      size="xs"
                      variant="outline"
                      className="min-w-0 px-1"
                      onClick={() => cropToAspect(ratio)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </FieldRow>
              <p className="text-2xs text-muted-foreground">
                The kept region becomes the clip&apos;s frame on the canvas.
              </p>
            </Section>
          );
        })()}

      {"opacity" in element && (
        <Section title="Opacity">
          <NumberField
            label="Opacity"
            value={Math.round(animValue("opacity", element.opacity) * 100)}
            min={0}
            max={100}
            unit="%"
            scrubPerPx={0.5}
            onCommit={(pct) => animCommit("opacity", (opacity) => patch({ opacity }))(pct / 100)}
            controls={kfControls("opacity")}
          />
        </Section>
      )}

      {(element.type === "video" || element.type === "audio") && (
        <Section title="Audio">
          <NumberField
            label="Volume"
            value={Math.round(animValue("volume", element.volume) * 100)}
            min={0}
            max={200}
            unit="%"
            scrubPerPx={0.5}
            onCommit={(pct) => animCommit("volume", (volume) => patch({ volume }))(pct / 100)}
            controls={kfControls("volume")}
          />
          <NumberField
            label="Fade in"
            value={(element.fadeInMs ?? 0) / 1000}
            step={0.1}
            min={0}
            max={element.durationMs / 1000}
            unit="s"
            onCommit={(s) => patch({ fadeInMs: Math.round(s * 1000) })}
          />
          <NumberField
            label="Fade out"
            value={(element.fadeOutMs ?? 0) / 1000}
            step={0.1}
            min={0}
            max={element.durationMs / 1000}
            unit="s"
            onCommit={(s) => patch({ fadeOutMs: Math.round(s * 1000) })}
          />
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">Muted</span>
            <Switch checked={element.muted} onCheckedChange={(muted) => patch({ muted })} />
          </div>
        </Section>
      )}

      {element.type === "multicam" && mode === "multicam" && (
        <MulticamSection element={element} />
      )}

      {(element.type === "video" ||
        element.type === "image" ||
        element.type === "text" ||
        element.type === "multicam") && (
        <>
          <EffectsSection element={element} />
          <TransitionSection element={element} track={selected.track} />
        </>
      )}

      {element.type === "text" && (
        <Section
          title="Text"
          actions={
            <PresetMenu
              kind="text-style"
              getValues={() => ({ ...element.style })}
              onApply={(values) => patchStyle(values)}
            />
          }
        >
          {/* Content edits INLINE on the canvas (double-click), with
              per-range bold/italic/color via the selection toolbar. */}
          <Button
            variant="outline"
            size="xs"
            onClick={() => setEditingTextId(element.id)}
          >
            Edit text on canvas
          </Button>
          <p className="text-2xs text-muted-foreground">
            Or double-click the text in the preview. Select a range there to
            bold, italicize, or recolor just those words.
          </p>
          <TextStyleSection
            style={element.style}
            patchStyle={patchStyle}
            spacing={{
              value: Math.round(animValue("letterSpacing", element.style.letterSpacing ?? 0) * 10) / 10,
              onCommit: animCommit("letterSpacing", (letterSpacing) => patchStyle({ letterSpacing })),
              controls: kfControls("letterSpacing"),
            }}
          />
        </Section>
      )}

      {element.type === "caption" && (
        <Section title="Caption">
          <Textarea
            value={element.text}
            rows={3}
            className="text-xs"
            onChange={(e) => patch({ text: e.target.value, words: [] })}
          />
          <ChoiceRow
            label="Position"
            value={element.style.position}
            options={["top", "middle", "bottom"] as const}
            onCommit={(position) => patchStyle({ position })}
          />
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">Font</span>
            <FontPicker
              value={element.style.fontFamily}
              weight={element.style.fontWeight}
              onSelect={(fontFamily) => patchStyle({ fontFamily })}
              className="flex-1"
            />
          </div>
          <NumberField
            label="Size"
            value={element.style.fontSize}
            min={4}
            unit="px"
            onCommit={(fontSize) => patchStyle({ fontSize })}
          />
          <ColorField
            label="Color"
            value={element.style.color}
            onCommit={(color) => patchStyle({ color })}
          />
          <ColorField
            label="Fill"
            value={element.style.backgroundColor}
            onCommit={(backgroundColor) => patchStyle({ backgroundColor })}
          />
        </Section>
      )}
    </div>
  );
}
