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

let searchInput: HTMLInputElement | null = null;
let pendingFocus = false;

function focusSearch(input: HTMLInputElement): void {
  input.focus();
  input.select();
}

export function focusTranscriptSearch(): void {
  if (searchInput) focusSearch(searchInput);
  else pendingFocus = true;
}

export function attachTranscriptSearch(input: HTMLInputElement | null): void {
  searchInput = input;
  if (input && pendingFocus) {
    pendingFocus = false;
    focusSearch(input);
  }
}
