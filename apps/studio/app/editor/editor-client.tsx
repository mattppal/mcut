"use client";

import type { TranscriptResult } from "@mcut/transcription";
import { EditorShell } from "@/registry/mcut/editor-shell";
import {
  isOnDeviceTranscriptionEnabled,
  transcribeOnDevice,
} from "@/registry/mcut/local-transcription";

/** Upload extracted audio to the demo's transcription route. */
async function transcribeRemote(audio: Blob): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("audio", audio, "audio.wav");
  const response = await fetch("/api/transcribe", { method: "POST", body: form });
  const json = (await response.json()) as TranscriptResult & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `Transcription failed (${response.status})`);
  }
  return json;
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
