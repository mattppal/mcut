"use client";

import { toast } from "sonner";
import { loadMediaBlob } from "@mcut/media";
import { parseProject, type EditorEngine, type Project } from "@mcut/timeline";
import { pickFiles } from "./media-import";

/**
 * Project files: the document JSON travels; media does not. Asset `src`s are
 * runtime bindings (usually blob: URLs) — on open we rebind them from the
 * OPFS media store by content hash, the same identity autosave uses, and
 * warn about anything that needs re-importing.
 */

function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function saveProjectToFile(project: Project): void {
  const slug = (project.name || "untitled").trim().replace(/[\\/:*?"<>|]+/g, "-");
  downloadText(JSON.stringify(project, null, 2), `${slug}.mcut.json`, "application/json");
  toast.success("Project file saved — media re-links by content hash on this device");
}

export async function openProjectFromFile(engine: EditorEngine): Promise<void> {
  const [file] = await pickFiles(".json,application/json", false);
  if (!file) return;
  let project: Project;
  try {
    project = parseProject(JSON.parse(await file.text()));
  } catch (error) {
    console.error(error);
    toast.error(`${file.name} is not a valid mcut project file`);
    return;
  }

  const missing: string[] = [];
  const assets = { ...project.assets };
  for (const [id, asset] of Object.entries(assets)) {
    const blob = asset.hash ? await loadMediaBlob(asset.hash).catch(() => null) : null;
    if (blob) {
      assets[id] = { ...asset, src: URL.createObjectURL(blob) };
    } else if (asset.src.startsWith("blob:")) {
      missing.push(id);
    }
  }

  engine.loadProject({ ...project, assets });
  if (missing.length > 0) {
    toast.warning(
      `${missing.length} media file(s) are not on this device — re-import them to relink.`,
    );
  } else {
    toast.success(`Opened ${project.name}`);
  }
}
