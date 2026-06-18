"use client";

import { extractAudioToWav } from "@mcut/media";
import {
  buildApplyCaptionsCommand,
  type TranscribeOptions,
  type TranscriptResult,
} from "@mcut/transcription";
import {
  getProjectCaptions,
  getProjectTranscript,
  rangesOverlap,
  type EditorEngine,
  type ElementAudioSource,
  type ElementId,
  type ProjectTranscriptContext,
  resolveElementAudioSource,
} from "@mcut/timeline";
import {
  isLocalTranscriptionSupported,
  transcribeOnDevice,
} from "./local-transcription";

export interface EnsureTranscriptPayload {
  elementId?: string;
  replace?: boolean;
  language?: string;
}

export interface EnsureTranscriptDeps {
  isLocalTranscriptionSupported: () => boolean;
  extractAudioToWav: (src: string) => Promise<Blob | null>;
  transcribeOnDevice: (
    audio: Blob,
    options?: TranscribeOptions,
  ) => Promise<TranscriptResult>;
}

export interface EnsureTranscriptResult {
  applied: boolean;
  reason?: string;
  source: {
    elementId: string;
    assetId: string;
    assetName?: string;
    startMs: number;
    endMs: number;
    sourceStartMs: number;
    sourceEndMs: number;
  };
  transcript: ProjectTranscriptContext;
}

const browserDeps: EnsureTranscriptDeps = {
  isLocalTranscriptionSupported,
  extractAudioToWav: (src) => extractAudioToWav(src),
  transcribeOnDevice,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePayload(value: unknown): EnsureTranscriptPayload {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.elementId === "string" ? { elementId: value.elementId } : {}),
    ...(typeof value.replace === "boolean" ? { replace: value.replace } : {}),
    ...(typeof value.language === "string" && value.language.trim()
      ? { language: value.language.trim() }
      : {}),
  };
}

function pickTranscriptionSource(
  engine: EditorEngine,
  payload: EnsureTranscriptPayload,
): ElementAudioSource {
  const project = engine.project;
  if (payload.elementId) {
    const source = resolveElementAudioSource(project, payload.elementId as ElementId);
    if (!source) throw new Error(`Element "${payload.elementId}" has no source audio.`);
    return source;
  }

  for (const elementId of engine.selection.elementIds) {
    const source = resolveElementAudioSource(project, elementId);
    if (source) return source;
  }

  const source = project.tracks
    .flatMap((track) => track.elements)
    .sort((a, b) => a.startMs - b.startMs)
    .map((element) => resolveElementAudioSource(project, element.id))
    .find((candidate): candidate is ElementAudioSource => candidate !== null);
  if (!source) throw new Error("Add a video, audio, or multicam clip with source audio to the timeline first.");
  return source;
}

function assertBridgeTranscriptionSupported(source: ElementAudioSource): void {
  if (source.reversed) {
    throw new Error("Bridge transcription does not support reversed clips yet.");
  }
  if (source.timeMap) {
    throw new Error("Bridge transcription does not support speed-ramped clips yet.");
  }
}

function overlappingCaptions(engine: EditorEngine, source: ElementAudioSource) {
  return getProjectCaptions(engine.project).filter(({ caption }) =>
    rangesOverlap(
      caption.startMs,
      caption.durationMs,
      source.timelineStartMs,
      source.timelineDurationMs,
    ),
  );
}

function sourceResult(source: ElementAudioSource): EnsureTranscriptResult["source"] {
  return {
    elementId: source.elementId,
    assetId: source.asset.id,
    ...(source.asset.name ? { assetName: source.asset.name } : {}),
    startMs: source.timelineStartMs,
    endMs: source.timelineStartMs + source.timelineDurationMs,
    sourceStartMs: source.sourceStartMs,
    sourceEndMs: source.sourceEndMs,
  };
}

export async function ensureTranscriptForBridge(
  engine: EditorEngine,
  value: unknown,
  deps: EnsureTranscriptDeps = browserDeps,
): Promise<EnsureTranscriptResult> {
  const payload = parsePayload(value);
  const source = pickTranscriptionSource(engine, payload);
  const sourceInfo = sourceResult(source);
  const existing = overlappingCaptions(engine, source);

  if (!payload.replace && existing.length > 0) {
    return {
      applied: false,
      reason: "Transcript captions already overlap the target clip.",
      source: sourceInfo,
      transcript: getProjectTranscript(engine.project, { includeWords: true }),
    };
  }

  assertBridgeTranscriptionSupported(source);
  if (!deps.isLocalTranscriptionSupported()) {
    throw new Error(
      "Local Whisper transcription is not supported in this browser. Use a WebGPU-capable browser with enough memory.",
    );
  }

  const wav = await deps.extractAudioToWav(source.asset.src);
  if (!wav) {
    throw new Error(`"${source.asset.name ?? source.asset.id}" has no audio track.`);
  }

  const options = payload.language ? { language: payload.language } : undefined;
  const result = await deps.transcribeOnDevice(wav, options);
  const command = buildApplyCaptionsCommand(result, {
    replace: false,
    timeOffsetMs: source.timelineStartMs,
    sourceStartMs: source.sourceStartMs,
    sourceEndMs: source.sourceEndMs,
  });
  if (!Array.isArray(command.captions) || command.captions.length === 0) {
    throw new Error("Transcription produced no captions for the target clip.");
  }

  engine.transact(() => {
    if (payload.replace) {
      for (const { caption } of overlappingCaptions(engine, source)) {
        engine.dispatch({ type: "removeElement", elementId: caption.id });
      }
    }
    engine.dispatch(command);
  });

  return {
    applied: true,
    source: sourceInfo,
    transcript: getProjectTranscript(engine.project, { includeWords: true }),
  };
}
