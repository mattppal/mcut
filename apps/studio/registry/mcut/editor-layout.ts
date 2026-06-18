"use client";

export const EDITOR_LAYOUT_KEYS = {
  vertical: "mcut:layout:v1:vertical",
  horizontal: "mcut:layout:v1:horizontal",
} as const;

const LEGACY_LAYOUT_KEYS = ["mcut:layout-v", "mcut:layout-h"] as const;

export const EDITOR_LAYOUT_RESET_EVENT = "mcut:layout-reset";

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

export function requestEditorLayoutReset() {
  clearEditorLayoutStorage();
  window.dispatchEvent(new Event(EDITOR_LAYOUT_RESET_EVENT));
}
