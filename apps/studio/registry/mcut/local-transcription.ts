"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  createLocalWhisperProvider,
  isLocalTranscriptionSupported,
  pickDefaultModel,
  WHISPER_MODELS,
} from "@mcut/transcription-local";
import type { TranscribeOptions, TranscriptResult } from "@mcut/transcription";

/**
 * On-device Whisper, offered but never forced: the server provider stays
 * the default, capable browsers (WebGPU + enough memory) get an opt-in
 * toggle in the captions panel. The choice persists per browser; the model
 * (~40–150MB) downloads once and is cached after that.
 */

export { isLocalTranscriptionSupported };

const STORAGE_KEY = "mcut:transcription:on-device:v1";

const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isOnDeviceTranscriptionEnabled(): boolean {
  return isLocalTranscriptionSupported() && read();
}

export function setOnDeviceTranscriptionEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Private mode: the toggle just doesn't persist.
  }
  for (const listener of listeners) listener();
}

export function useOnDeviceTranscription(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
    () => false,
  );
}

/** Rough one-time download size for the default model, for the opt-in copy. */
export function defaultModelDownloadLabel(): string {
  return pickDefaultModel() === WHISPER_MODELS.base ? "~145 MB" : "~40 MB";
}

// The provider (and its worker + loaded model) lives for the session.
let provider: ReturnType<typeof createLocalWhisperProvider> | null = null;

const PROGRESS_TOAST_ID = "mcut-on-device-transcription";

export async function transcribeOnDevice(
  audio: Blob,
  options?: TranscribeOptions,
): Promise<TranscriptResult> {
  provider ??= createLocalWhisperProvider({
    onProgress: ({ phase, progress }) => {
      const percent = Math.round(progress * 100);
      toast.loading(
        phase === "model"
          ? `Downloading Whisper model… ${percent}% (one-time, cached after this)`
          : `Transcribing on this device… ${percent}%`,
        { id: PROGRESS_TOAST_ID },
      );
    },
  });
  try {
    return await provider.transcribe({ audio, mimeType: audio.type || "audio/wav" }, options);
  } finally {
    toast.dismiss(PROGRESS_TOAST_ID);
  }
}
