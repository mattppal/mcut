import { describe, expect, test } from "bun:test";
import { EditorEngine, createProject, getAnimatedValue, getElement } from "@mcut/timeline";
import { STUDIO_ZOOM_PRESETS } from "./zoom-presets";

function zoomPreset(name: string) {
  const preset = STUDIO_ZOOM_PRESETS.find((candidate) => candidate.name === name);
  if (!preset) throw new Error(`missing zoom preset "${name}"`);
  return preset;
}

describe("studio zoom presets", () => {
  test("punch in followed by punch out returns to the original scale", () => {
    const engine = new EditorEngine({ project: createProject() });
    const trackId = engine.project.tracks[0]!.id;

    engine.dispatch({
      type: "addElement",
      trackId,
      element: {
        id: "e-punch-test",
        type: "text",
        startMs: 0,
        durationMs: 2000,
        text: "Punch",
      },
    });

    engine.dispatch({
      type: "applyZoomPreset",
      elementId: "e-punch-test",
      preset: zoomPreset("Punch in"),
      atMs: 0,
    });
    engine.dispatch({
      type: "applyZoomPreset",
      elementId: "e-punch-test",
      preset: zoomPreset("Punch out"),
      atMs: 350,
    });

    const element = getElement(engine.project, "e-punch-test");
    if (!element) throw new Error("missing test element");

    expect(getAnimatedValue(element, "scale.x", 0)).toBe(1);
    expect(getAnimatedValue(element, "scale.x", 350)).toBe(1.25);
    expect(getAnimatedValue(element, "scale.x", 700)).toBe(1);
    expect(getAnimatedValue(element, "scale.y", 700)).toBe(1);
  });
});
