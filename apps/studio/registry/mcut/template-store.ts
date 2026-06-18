"use client";

import { useSyncExternalStore } from "react";

/**
 * The user's template library (zooms, layouts): app-level
 * persistence, NOT project data — projects only ever contain the expanded
 * primitives (keyframes/elements), so documents stay portable. localStorage
 * with a version field and tolerant parsing (the louisville draft pattern);
 * JSON import/export for sharing.
 */

export type TemplateKind = "zoom" | "layout";

export interface UserTemplate<P = unknown> {
  id: string;
  kind: TemplateKind;
  name: string;
  payload: P;
}

const STORE_KEY = "mcut:templates:v1";
const listeners = new Set<() => void>();
let cache: UserTemplate[] | null = null;

function read(): UserTemplate[] {
  if (cache) return cache;
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "[]");
    cache = Array.isArray(raw)
      ? raw.filter(
          (t): t is UserTemplate =>
            t &&
            typeof t.id === "string" &&
            typeof t.name === "string" &&
            (t.kind === "zoom" || t.kind === "layout"),
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(templates: UserTemplate[]): void {
  cache = templates;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(templates));
  } catch {
    // Private mode: the library just doesn't persist.
  }
  for (const listener of listeners) listener();
}

export function listTemplates<P>(kind: TemplateKind): UserTemplate<P>[] {
  return read().filter((t) => t.kind === kind) as UserTemplate<P>[];
}

export function saveTemplate<P>(kind: TemplateKind, name: string, payload: P): UserTemplate<P> {
  const template: UserTemplate<P> = {
    id: `tpl-${crypto.randomUUID().slice(0, 12)}`,
    kind,
    name,
    payload,
  };
  write([...read(), template]);
  return template;
}

export function removeTemplate(id: string): void {
  write(read().filter((t) => t.id !== id));
}

export function exportTemplatesJson(kind?: TemplateKind): string {
  const templates = kind ? read().filter((t) => t.kind === kind) : read();
  return JSON.stringify(templates, null, 2);
}

export function importTemplatesJson(json: string): number {
  const incoming = JSON.parse(json);
  if (!Array.isArray(incoming)) return 0;
  const existing = read();
  const known = new Set(existing.map((t) => t.id));
  const fresh = incoming.filter(
    (t): t is UserTemplate => t && typeof t.id === "string" && !known.has(t.id),
  );
  write([...existing, ...fresh]);
  return fresh.length;
}

const EMPTY: UserTemplate[] = [];
const snapshots = new Map<TemplateKind, UserTemplate[]>();

/** Reactive list of one kind (useSyncExternalStore over the local library). */
export function useTemplates<P>(kind: TemplateKind): UserTemplate<P>[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => {
      const all = read();
      const filtered = all.filter((t) => t.kind === kind);
      const previous = snapshots.get(kind);
      // Stable snapshot identity, or React loops.
      if (
        previous &&
        previous.length === filtered.length &&
        previous.every((t, i) => t === filtered[i])
      ) {
        return previous as UserTemplate<P>[];
      }
      snapshots.set(kind, filtered);
      return filtered as UserTemplate<P>[];
    },
    () => EMPTY as UserTemplate<P>[],
  ) as UserTemplate<P>[];
}
