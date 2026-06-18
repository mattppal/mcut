"use client";

import { toast } from "sonner";
import { createAssetFromFile } from "@mcut/media";
import type { EditorEngine } from "@mcut/timeline";
import type { AssetRef } from "@mcut/timeline";

/** Optional hook for persistence layers: original Files by asset id. */
export type OnAssetImported = (asset: AssetRef, file: File) => void;

/**
 * Shared import path for the media bin, drag-drop, and the File menu:
 * probe each file (Mediabunny), register the asset, and hand the original
 * File to the persistence callback. Per-file failures toast and are skipped.
 */
export async function importMediaFiles(
  engine: EditorEngine,
  files: File[],
  onAssetImported?: OnAssetImported,
): Promise<AssetRef[]> {
  const imported: AssetRef[] = [];
  for (const file of files) {
    try {
      const asset = await createAssetFromFile(file);
      engine.dispatch({ type: "addAsset", asset }, { history: false });
      imported.push(asset);
      onAssetImported?.(asset, file);
    } catch (error) {
      console.error(error);
      toast.error(`Could not import ${file.name}`);
    }
  }
  return imported;
}

/** One-shot native file picker (resolves [] when the user cancels). */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
