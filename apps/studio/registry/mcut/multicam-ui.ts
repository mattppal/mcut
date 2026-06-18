import {
  getActiveAngleIndex,
  type EditorEngine,
  type MulticamElement,
  type Project,
} from "@mcut/timeline";

/**
 * Multicam UI helpers: which multicam the mode operates on, and the
 * playing-vs-paused switch semantics (Premiere parity — see the plan doc).
 */

export interface LocatedMulticam {
  element: MulticamElement;
  trackId: Project["tracks"][number]["id"];
}

/** The multicam the bank/hotkeys target: selected first, else under playhead, else first. */
export function findTargetMulticam(
  project: Project,
  selectedIds: readonly string[],
  playheadMs: number,
): LocatedMulticam | null {
  let underPlayhead: LocatedMulticam | null = null;
  let first: LocatedMulticam | null = null;
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if (element.type !== "multicam") continue;
      const located = { element, trackId: track.id };
      if (selectedIds.includes(element.id)) return located;
      if (
        !underPlayhead &&
        playheadMs >= element.startMs &&
        playheadMs < element.startMs + element.durationMs
      ) {
        underPlayhead = located;
      }
      if (!first) first = located;
    }
  }
  return underPlayhead ?? first;
}

/**
 * The multicam switch gesture: while PLAYING a press cuts at the playhead
 * (you're performing the edit live); while PAUSED it corrects the layout of
 * the span under the playhead. This split is what makes multicam editing
 * fast — copy Premiere exactly.
 */
export function switchToLayout(
  engine: EditorEngine,
  element: MulticamElement,
  layoutId: string,
): void {
  const playheadMs = engine.playback.state.currentTimeMs;
  const localMs = Math.round(playheadMs - element.startMs);
  if (localMs < 0 || localMs >= element.durationMs) return;
  try {
    if (engine.playback.state.isPlaying && localMs > 0) {
      engine.dispatch({ type: "addAngleCut", elementId: element.id, atMs: localMs, layoutId });
    } else {
      const span = element.angles[getActiveAngleIndex(element.angles, localMs)];
      if (!span) return;
      engine.dispatch({
        type: "setAngleLayout",
        elementId: element.id,
        atMs: span.atMs,
        layoutId,
      });
    }
  } catch {
    // Cut collided with an existing one at the same ms: ignore.
  }
}
