import { describe, expect, test } from "bun:test";
import {
  EditorEngine,
  createProject,
  getElement,
  type AnimatableProperty,
  type TimelineElement,
} from "@mcut/timeline";
import {
  canMoveKeyframeGroup,
  clampKeyframeDragTarget,
  isKeyframeDragPastThreshold,
  isKeyframeSnapEnabled,
  keyframePropertiesAt,
  resolveKeyframeClickGesture,
} from "./clip-keyframes";

function setupElement(): { engine: EditorEngine; element: TimelineElement } {
  const engine = new EditorEngine({ project: createProject() });
  const trackId = engine.project.tracks[0]!.id;
  engine.dispatch({
    type: "addElement",
    trackId,
    element: {
      id: "e-keyframe-drag-test",
      type: "text",
      startMs: 1000,
      durationMs: 2000,
      text: "Keyframe",
    },
  });
  const element = getElement(engine.project, "e-keyframe-drag-test");
  if (!element) throw new Error("missing test element");
  return { engine, element };
}

function setKeyframes(
  engine: EditorEngine,
  elementId: string,
  property: AnimatableProperty,
  times: readonly number[],
) {
  for (const timeMs of times) {
    engine.dispatch({
      type: "setKeyframe",
      elementId,
      property,
      timeMs,
      value: property.startsWith("scale") ? 1 : 0,
    });
  }
}

describe("timeline keyframe drag helpers", () => {
  test("Option-click deletes only when movement stays below the drag threshold", () => {
    expect(isKeyframeDragPastThreshold(100, 102)).toBe(false);
    expect(isKeyframeDragPastThreshold(100, 103)).toBe(true);
    expect(
      resolveKeyframeClickGesture({ moved: false, startedAltKey: true, endedAltKey: true }),
    ).toBe("delete");
    expect(
      resolveKeyframeClickGesture({ moved: true, startedAltKey: true, endedAltKey: true }),
    ).toBe("none");
  });

  test("plain click seeks and Option-drag disables snapping without deleting", () => {
    expect(
      resolveKeyframeClickGesture({ moved: false, startedAltKey: false, endedAltKey: false }),
    ).toBe("seek");
    expect(isKeyframeSnapEnabled(true, false)).toBe(true);
    expect(isKeyframeSnapEnabled(true, true)).toBe(false);
    expect(isKeyframeSnapEnabled(false, false)).toBe(false);
  });

  test("drag target clamps to clip bounds", () => {
    const { element } = setupElement();
    expect(clampKeyframeDragTarget(element, ["scale.x"], 500, -10)).toBe(0);
    expect(clampKeyframeDragTarget(element, ["scale.x"], 500, 2500)).toBe(2000);
  });

  test("drag target clamps away from neighboring same-property keyframes", () => {
    const { engine, element } = setupElement();
    setKeyframes(engine, element.id, "scale.x", [100, 500, 900]);
    const updated = getElement(engine.project, element.id);
    if (!updated) throw new Error("missing updated element");

    expect(clampKeyframeDragTarget(updated, ["scale.x"], 500, 100)).toBe(101);
    expect(clampKeyframeDragTarget(updated, ["scale.x"], 500, 900)).toBe(899);
  });

  test("grouped scale keyframes move together and reject colliding targets", () => {
    const { engine, element } = setupElement();
    setKeyframes(engine, element.id, "scale.x", [500, 900]);
    setKeyframes(engine, element.id, "scale.y", [500, 900]);
    const updated = getElement(engine.project, element.id);
    if (!updated) throw new Error("missing updated element");

    expect(keyframePropertiesAt(updated, 500).sort()).toEqual(["scale.x", "scale.y"]);
    expect(canMoveKeyframeGroup(updated, ["scale.x", "scale.y"], 500, 600)).toBe(true);
    expect(canMoveKeyframeGroup(updated, ["scale.x", "scale.y"], 500, 900)).toBe(false);
  });
});
