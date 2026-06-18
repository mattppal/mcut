"use client";

/**
 * Window event that opens the ⌘K palette. Lives apart from the palette
 * component so action declarations can dispatch it without a circular
 * import (command-palette.tsx imports the default actions).
 */
export const COMMAND_PALETTE_OPEN_EVENT = "mcut:command-palette-open";

export function openCommandPalette() {
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
}
