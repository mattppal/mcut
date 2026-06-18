"use client";

import { renderFrame, type FrameSource } from "@mcut/compositor";
import { createAssetFromFile, getActiveMediaItems, type PreviewMediaPool } from "@mcut/media";
import type { AssetRef, EditorEngine } from "@mcut/timeline";
import { ensureProjectFontsLoaded } from "./font-library";
import { saveAssetBlob } from "./persistence";

export interface ViewportStill {
  asset: AssetRef;
  file: File;
  width: number;
  height: number;
}

export interface CaptureViewportStillOptions {
  scale?: number;
  source?: FrameSource | PreviewMediaPool;
}

function slugPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mcut"
  );
}

function timePart(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const ms = Math.max(0, Math.round(timeMs % 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours.toString().padStart(2, "0")}-${minutes
    .toString()
    .padStart(2, "0")}-${seconds.toString().padStart(2, "0")}-${ms.toString().padStart(3, "0")}`;
}

async function canvasToPngFile(canvas: HTMLCanvasElement, filename: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode PNG");
  return new File([blob], filename, { type: "image/png" });
}

/**
 * Render the current playhead frame into a PNG, register it as a normal image
 * asset, and persist the blob so it survives reload with the rest of the bin.
 */
export async function captureViewportStill(
  engine: EditorEngine,
  options: CaptureViewportStillOptions = {},
): Promise<ViewportStill> {
  const project = engine.project;
  const timeMs = engine.playback.state.currentTimeMs;
  const scale = Math.max(1, Math.min(4, Math.round(options.scale ?? 1)));
  const width = Math.max(1, Math.round(project.width * scale));
  const height = Math.max(1, Math.round(project.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create capture canvas");

  const source = options.source;
  if (source && "sync" in source) {
    source.sync(getActiveMediaItems(project, timeMs), {
      isPlaying: false,
      playbackRate: engine.playback.state.playbackRate,
      masterVolume: engine.playback.state.volume,
      muted: true,
    });
  }

  await ensureProjectFontsLoaded(project);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderFrame(ctx, project, timeMs, { source });

  const suffix = scale === 1 ? "" : `-${scale}x`;
  const file = await canvasToPngFile(
    canvas,
    `${slugPart(project.name)}-${timePart(timeMs)}${suffix}.png`,
  );
  const asset = await createAssetFromFile(file);
  engine.dispatch({ type: "addAsset", asset }, { history: false });
  await saveAssetBlob(asset, file);
  return { asset, file, width, height };
}
