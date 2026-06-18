import type { AnimationPreset, EditorEngine, TimelineElement, ZoomPreset } from "@mcut/timeline";

const PUNCH_ZOOM_DURATION_MS = 240;
const PUNCH_ZOOM_SCALE = 1.15;

const PUNCH_ZOOM_PRESET: ZoomPreset = {
  name: "Punch zoom",
  durationMs: PUNCH_ZOOM_DURATION_MS,
  tracks: {
    "scale.x": [
      { t: 0, value: 1, easing: { cubicBezier: [0.16, 1, 0.3, 1] } },
      { t: 1, value: PUNCH_ZOOM_SCALE },
    ],
    "scale.y": [
      { t: 0, value: 1, easing: { cubicBezier: [0.16, 1, 0.3, 1] } },
      { t: 1, value: PUNCH_ZOOM_SCALE },
    ],
  },
};

/**
 * Studio-level preset tuning. The SDK's punch-zoom is intentionally sharp and
 * starts at clip-local 0 with auto motion blur. In the product UI, "punch"
 * should land where the playhead is parked, so we apply it as a clean saved
 * zoom pattern instead.
 */
export function applyStudioAnimationPreset(
  engine: EditorEngine,
  element: TimelineElement,
  preset: AnimationPreset,
  timelineMs: number = element.startMs,
) {
  if (preset !== "punch-zoom") {
    engine.dispatch({ type: "applyAnimationPreset", elementId: element.id, preset });
    return;
  }

  const atMs = Math.round(
    Math.max(0, Math.min(timelineMs - element.startMs, element.durationMs - PUNCH_ZOOM_DURATION_MS)),
  );
  engine.dispatch({
    type: "applyZoomPreset",
    elementId: element.id,
    preset: PUNCH_ZOOM_PRESET,
    atMs,
  });
}
