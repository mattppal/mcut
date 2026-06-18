import { describe, expect, test } from "bun:test";
import { collectSnapTargets, pointerToTimelineMs, snapClip, snapTime } from "./timeline-snap";
import { createProject, applyCommand, type Project, type SnapTarget } from "@mcut/timeline";

function projectWithClip(startMs: number, durationMs: number): Project {
  let project = createProject();
  const trackId = project.tracks[0]!.id;
  project = applyCommand(project, {
    type: "addElement",
    trackId,
    element: { type: "text", startMs, durationMs, text: "x" },
  });
  return project;
}

const at = (...times: number[]): SnapTarget[] =>
  times.map((timeMs) => ({ timeMs, kind: "clip-start" as const }));

describe("snapTime", () => {
  test("snaps to nearest target within threshold", () => {
    expect(snapTime(1010, at(0, 1000, 2000), 50)).toMatchObject({ ms: 1000, guideMs: 1000 });
    expect(snapTime(1990, at(0, 1000, 2000), 50)).toMatchObject({ ms: 2000, guideMs: 2000 });
  });
  test("passes through outside threshold or when disabled", () => {
    expect(snapTime(1500, at(0, 1000, 2000), 50)).toMatchObject({ ms: 1500, guideMs: null });
    expect(snapTime(1010, at(1000), 50, { enabled: false })).toMatchObject({
      ms: 1010,
      guideMs: null,
    });
  });
  test("frame-quantizes un-snapped times when fps is given", () => {
    expect(snapTime(1505, at(0), 50, { fps: 30 }).ms).toBe(1500);
  });
});

describe("snapClip", () => {
  test("snaps by trailing edge when that edge is closer", () => {
    // Clip [950, 1950): end is 50 from 2000, start is 50 from 1000 — tie → start wins.
    expect(snapClip(950, 1000, at(1000, 2000), 60)).toMatchObject({ ms: 1000, guideMs: 1000 });
    // Clip [940, 1960): end is 40 from 2000, start 60 from 1000 → end wins, start shifts.
    expect(snapClip(940, 1020, at(1000, 2000), 60)).toMatchObject({ ms: 980, guideMs: 2000 });
  });
});

describe("collectSnapTargets", () => {
  test("includes zero, playhead, markers, and clip edges; excludes dragged ids", () => {
    let project = projectWithClip(500, 800);
    project = applyCommand(project, { type: "addMarker", id: "m-1", timeMs: 900 });
    const id = project.tracks[0]!.elements[0]!.id;
    expect(collectSnapTargets(project, 4321).map((t) => t.timeMs)).toEqual([
      0, 500, 900, 1300, 4321,
    ]);
    expect(collectSnapTargets(project, 900, new Set([id])).map((t) => t.timeMs)).toEqual([
      0, 900, 900,
    ]);
    expect(collectSnapTargets(project, 4321).find((t) => t.timeMs === 900)?.kind).toBe("marker");
  });
});

describe("pointerToTimelineMs", () => {
  test("maps clientX through lane origin and zoom", () => {
    expect(pointerToTimelineMs(300, { left: 100 }, 0.05)).toBe(4000);
    expect(pointerToTimelineMs(50, { left: 100 }, 0.05)).toBe(0); // clamped
  });
});
