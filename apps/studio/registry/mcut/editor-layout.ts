"use client";

export const EDITOR_LAYOUT_KEYS = {
  vertical: "mcut:layout:v1:vertical",
  horizontal: "mcut:layout:v1:horizontal",
} as const;

const LEGACY_LAYOUT_KEYS = ["mcut:layout-v", "mcut:layout-h"] as const;

export function clearEditorLayoutStorage() {
  if (typeof window === "undefined") return;
  for (const key of [
    EDITOR_LAYOUT_KEYS.vertical,
    EDITOR_LAYOUT_KEYS.horizontal,
    ...LEGACY_LAYOUT_KEYS,
  ]) {
    window.localStorage.removeItem(key);
  }
}
