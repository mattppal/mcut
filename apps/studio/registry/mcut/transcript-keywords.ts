"use client";

import { useSyncExternalStore } from "react";

/**
 * Persisted transcript keyword terms (e.g. product names), per project.
 * Occurrences highlight in the transcript panel and render as soft ticks on
 * the timeline ruler. Module store + localStorage, the font-library pattern
 * — both panels subscribe without threading props through the shell.
 */

const storageKey = (projectId: string) => `mcut:transcript:keywords:v1:${projectId}`;

const listeners = new Set<() => void>();
const cache = new Map<string, string[]>();
const EMPTY: string[] = [];

function notify(): void {
  for (const listener of listeners) listener();
}

function read(projectId: string): string[] {
  if (typeof window === "undefined") return EMPTY;
  let value = cache.get(projectId);
  if (!value) {
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey(projectId)) ?? "[]");
      value = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
    } catch {
      value = [];
    }
    cache.set(projectId, value);
  }
  return value;
}

export function getTranscriptKeywords(projectId: string): string[] {
  return read(projectId);
}

export function setTranscriptKeywords(projectId: string, keywords: string[]): void {
  const cleaned = [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0))];
  cache.set(projectId, cleaned);
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(cleaned));
  } catch {
    // Private mode: keywords just don't persist.
  }
  notify();
}

export function addTranscriptKeyword(projectId: string, keyword: string): void {
  setTranscriptKeywords(projectId, [...read(projectId), keyword]);
}

export function removeTranscriptKeyword(projectId: string, keyword: string): void {
  setTranscriptKeywords(
    projectId,
    read(projectId).filter((k) => k !== keyword),
  );
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Reactive keyword list for a project. */
export function useTranscriptKeywords(projectId: string): string[] {
  return useSyncExternalStore(
    subscribe,
    () => read(projectId),
    () => EMPTY,
  );
}

// ---------------------------------------------------------------------------
// Find-in-transcript event (⌘F): the shell switches to the transcript tab,
// the panel focuses its search box — split so neither imports the other.
// ---------------------------------------------------------------------------

export const TRANSCRIPT_FIND_EVENT = "mcut:transcript-find";

let pendingFocus = false;

export function requestTranscriptFind(): void {
  pendingFocus = true;
  window.dispatchEvent(new Event(TRANSCRIPT_FIND_EVENT));
}

/** The panel calls this on mount to honor a find request that arrived while unmounted. */
export function consumePendingTranscriptFind(): boolean {
  const was = pendingFocus;
  pendingFocus = false;
  return was;
}
