import { planSilenceCuts } from "@mcut/editor";
import {
  getElementLocation,
  getProjectTranscript,
  type EditorEngine,
  type ElementId,
  type ProjectTranscriptWordContext,
  type TimelineElement,
} from "@mcut/timeline";

interface SilenceActionInput {
  elementId?: string;
  minGapMs?: number;
  paddingMs?: number;
  minKeepMs?: number;
  trimEnds?: boolean;
}

interface FadeActionInput {
  elementId?: string;
  durationMs?: number;
}

type VisualElement = TimelineElement & { type: "video" | "image" | "text" | "multicam" };
type MediaElement = TimelineElement & { type: "video" | "audio" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseSilenceInput(value: unknown): SilenceActionInput {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.elementId === "string" ? { elementId: value.elementId } : {}),
    ...(optionalFiniteNumber(value.minGapMs) !== undefined ? { minGapMs: optionalFiniteNumber(value.minGapMs) } : {}),
    ...(optionalFiniteNumber(value.paddingMs) !== undefined ? { paddingMs: optionalFiniteNumber(value.paddingMs) } : {}),
    ...(optionalFiniteNumber(value.minKeepMs) !== undefined ? { minKeepMs: optionalFiniteNumber(value.minKeepMs) } : {}),
    ...(optionalBoolean(value.trimEnds) !== undefined ? { trimEnds: optionalBoolean(value.trimEnds) } : {}),
  };
}

function parseFadeInput(value: unknown): FadeActionInput {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.elementId === "string" ? { elementId: value.elementId } : {}),
    ...(optionalFiniteNumber(value.durationMs) !== undefined ? { durationMs: optionalFiniteNumber(value.durationMs) } : {}),
  };
}

function isMediaElement(element: TimelineElement): element is MediaElement {
  return element.type === "video" || element.type === "audio";
}

function isVisualElement(element: TimelineElement): element is VisualElement {
  return (
    element.type === "video" ||
    element.type === "image" ||
    element.type === "text" ||
    element.type === "multicam"
  );
}

function pickElement<T extends TimelineElement>(
  engine: EditorEngine,
  explicitId: string | undefined,
  predicate: (element: TimelineElement) => element is T,
  emptyMessage: string,
): T {
  if (explicitId) {
    const location = getElementLocation(engine.project, explicitId as ElementId);
    if (!location || !predicate(location.element)) {
      throw new Error(`Element "${explicitId}" is not a supported target.`);
    }
    return location.element;
  }

  for (const elementId of engine.selection.elementIds) {
    const location = getElementLocation(engine.project, elementId);
    if (location && predicate(location.element)) return location.element;
  }

  for (const track of engine.project.tracks) {
    for (const element of track.elements) {
      if (predicate(element)) return element;
    }
  }

  throw new Error(emptyMessage);
}

function transcriptWordsForElement(
  engine: EditorEngine,
  element: MediaElement,
): Array<ProjectTranscriptWordContext & { sourceStartMs: number; sourceEndMs: number }> {
  if (element.timeMap) {
    throw new Error("Transcript silence removal requires a 1x clip with no time remap.");
  }

  const startMs = element.startMs;
  const endMs = element.startMs + element.durationMs;
  return getProjectTranscript(engine.project, { includeWords: true }).captions
    .flatMap((caption) => caption.words ?? [])
    .filter((word) => word.endMs > startMs && word.startMs < endMs)
    .map((word) => ({
      ...word,
      sourceStartMs: element.trimStartMs + (word.startMs - element.startMs),
      sourceEndMs: element.trimStartMs + (word.endMs - element.startMs),
    }));
}

export function removeTranscriptSilence(engine: EditorEngine, value: unknown): unknown {
  const input = parseSilenceInput(value);
  const element = pickElement(
    engine,
    input.elementId,
    isMediaElement,
    "Add or select a video/audio clip before removing silence.",
  );
  const words = transcriptWordsForElement(engine, element);
  if (words.length === 0) {
    throw new Error("No word-timed transcript overlaps the target clip. Call ensure_transcript first.");
  }

  const plan = planSilenceCuts(
    engine.project,
    element.id,
    {
      words: words.map((word) => ({
        startMs: Math.round(word.sourceStartMs),
        endMs: Math.round(word.sourceEndMs),
      })),
    },
    {
      ...(input.minGapMs !== undefined ? { minGapMs: input.minGapMs } : {}),
      ...(input.paddingMs !== undefined ? { paddingMs: input.paddingMs } : {}),
      ...(input.minKeepMs !== undefined ? { minKeepMs: input.minKeepMs } : {}),
      ...(input.trimEnds !== undefined ? { trimEnds: input.trimEnds } : {}),
    },
  );

  if (plan.commands.length > 0) {
    engine.transact(() => {
      for (const command of plan.commands) engine.dispatch(command);
    });
  }

  return {
    elementId: element.id,
    applied: plan.commands.length,
    removedMs: plan.removedMs,
    silences: plan.silences,
  };
}

export function applyOpeningClosingFades(engine: EditorEngine, value: unknown): unknown {
  const input = parseFadeInput(value);
  const element = pickElement(
    engine,
    input.elementId,
    isVisualElement,
    "Add or select a visual clip before applying opening/closing fades.",
  );
  const durationMs = Math.max(10, Math.round(input.durationMs ?? 500));

  engine.transact(() => {
    engine.dispatch({
      type: "applyAnimationPreset",
      elementId: element.id,
      preset: "fade-in",
      options: { durationMs },
    });
    engine.dispatch({
      type: "applyAnimationPreset",
      elementId: element.id,
      preset: "fade-out",
      options: { durationMs },
    });
  });

  return {
    elementId: element.id,
    durationMs,
    presets: ["fade-in", "fade-out"],
  };
}
