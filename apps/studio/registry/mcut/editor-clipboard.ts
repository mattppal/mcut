import {
  createElementId,
  findNearestFreeSlot,
  getElementLocation,
  type EditorEngine,
  type ElementId,
  type TimelineElement,
} from "@mcut/timeline";

/**
 * The editor's internal clipboard: serialized clips with their original
 * track positions, pasted relative to the playhead. Survives within the
 * session; OS-clipboard JSON interop is a parity-list follow-up.
 */

interface ClipboardEntry {
  /** Deep-cloned element, id stripped (regenerated on paste). */
  element: Omit<TimelineElement, "id">;
  /** Model track index at copy time (pasted to the same lane when possible). */
  trackIndex: number;
  /** Offset from the earliest copied element's startMs. */
  offsetMs: number;
}

export interface EditorClipboard {
  entries: ClipboardEntry[];
}

export const editorClipboard: EditorClipboard = { entries: [] };

const ENVELOPE_VERSION = 1;

interface ClipboardEnvelope {
  mcutClipboard: number;
  entries: ClipboardEntry[];
}

function isEnvelope(value: unknown): value is ClipboardEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ClipboardEnvelope).mcutClipboard === ENVELOPE_VERSION &&
    Array.isArray((value as ClipboardEnvelope).entries)
  );
}

/** Mirror the internal clipboard to the OS clipboard (cross-tab/project paste). */
function writeOsClipboard(): void {
  const envelope: ClipboardEnvelope = {
    mcutClipboard: ENVELOPE_VERSION,
    entries: editorClipboard.entries,
  };
  navigator.clipboard?.writeText(JSON.stringify(envelope)).catch(() => {
    // Permission denied / insecure context: internal clipboard still works.
  });
}

/** Copy the selection. Returns how many clips were copied. */
export function copySelection(engine: EditorEngine): number {
  const located = engine.selection.elementIds
    .map((id) => getElementLocation(engine.project, id))
    .filter((location) => location !== undefined);
  if (located.length === 0) return 0;
  const earliestMs = Math.min(...located.map((l) => l.element.startMs));
  editorClipboard.entries = located.map(({ element, trackIndex }) => {
    const { id, ...clone } = JSON.parse(JSON.stringify(element)) as TimelineElement;
    void id;
    return { element: clone, trackIndex, offsetMs: element.startMs - earliestMs };
  });
  writeOsClipboard();
  return editorClipboard.entries.length;
}

export function cutSelection(engine: EditorEngine): number {
  const count = copySelection(engine);
  if (count === 0) return 0;
  engine.transact(() => {
    for (const elementId of engine.selection.elementIds) {
      try {
        engine.dispatch({ type: "removeElement", elementId });
      } catch {
        // Already removed.
      }
    }
  });
  return count;
}

/**
 * Paste at the playhead: the earliest copied clip lands there, the rest keep
 * their relative offsets and lanes (clamped to existing tracks, nudged to
 * free space). The pasted clips become the selection.
 */
export function pasteAtPlayhead(engine: EditorEngine): ElementId[] {
  if (editorClipboard.entries.length === 0) return [];
  const anchorMs = Math.max(0, Math.round(engine.playback.state.currentTimeMs));
  const pastedIds: ElementId[] = [];
  engine.transact(() => {
    for (const entry of editorClipboard.entries) {
      const project = engine.project;
      const trackIndex = Math.min(entry.trackIndex, project.tracks.length - 1);
      const track = project.tracks[trackIndex]!;
      const id = createElementId();
      const startMs = findNearestFreeSlot(
        track,
        anchorMs + entry.offsetMs,
        entry.element.durationMs,
      );
      try {
        engine.dispatch({
          type: "addElement",
          trackId: track.id,
          element: { ...entry.element, id, startMs },
        });
        pastedIds.push(id);
      } catch {
        // Asset was removed since copy, or no room: skip this clip.
      }
    }
  });
  if (pastedIds.length > 0) engine.select(pastedIds);
  return pastedIds;
}

/**
 * Paste from wherever has content: an mcut envelope on the OS clipboard
 * (written by copy in any mcut tab) wins; the internal clipboard is the
 * fallback when reading is denied or holds something else.
 */
export async function pasteAtPlayheadFromAnywhere(engine: EditorEngine): Promise<ElementId[]> {
  try {
    const text = await navigator.clipboard?.readText();
    if (text) {
      const parsed: unknown = JSON.parse(text);
      if (isEnvelope(parsed) && parsed.entries.length > 0) {
        editorClipboard.entries = parsed.entries;
      }
    }
  } catch {
    // Read permission denied or non-JSON content: use the internal entries.
  }
  return pasteAtPlayhead(engine);
}
