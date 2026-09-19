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

export function defaultModelDownloadLabel(): string {
  return pickDefaultModel() === WHISPER_MODELS.base ? "~145 MB" : "~40 MB";
}

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
