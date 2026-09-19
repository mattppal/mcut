"use client";

import { transcriptResultSchema, type TranscriptResult } from "@mcut/transcription";
import { z } from "zod";
import { EditorShell } from "@/registry/mcut/editor-shell";
import {
  isOnDeviceTranscriptionEnabled,
  transcribeOnDevice,
} from "@/registry/mcut/local-transcription";

const transcribeFailureSchema = z.object({ error: z.string() });

/** Upload extracted audio to the demo's transcription route. */
async function transcribeRemote(audio: Blob): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("audio", audio, "audio.wav");
  const response = await fetch("/api/transcribe", { method: "POST", body: form });
  const json: unknown = await response.json();
  if (!response.ok) {
    const failure = transcribeFailureSchema.safeParse(json);
    throw new Error(
      failure.success ? failure.data.error : `Transcription failed (${response.status})`,
    );
  }
  const result = transcriptResultSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Transcription returned an unexpected response: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Server transcription by default; on-device Whisper when the user opted in
 * via the captions panel (offered only on capable browsers — never forced).
 */
function transcribe(audio: Blob): Promise<TranscriptResult> {
  return isOnDeviceTranscriptionEnabled() ? transcribeOnDevice(audio) : transcribeRemote(audio);
}

export function EditorClient() {
  return <EditorShell transcribe={transcribe} />;
}
