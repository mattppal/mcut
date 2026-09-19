"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { extractAudioPeaks, getFilmstrip, type AudioPeaks, type Filmstrip } from "@mcut/media";
import { getSourceTimeMs, type AssetRef, type TimeMap } from "@mcut/timeline";
import { cn } from "@/lib/utils";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const filmstripCache = new Map<string, Promise<Filmstrip | null>>();
const resolvedFilmstrips = new Map<string, Filmstrip | null>();
const peaksCache = new Map<string, Promise<AudioPeaks | null>>();
const resolvedPeaks = new Map<string, AudioPeaks | null>();

export function filmstripFrameIndex(strip: Filmstrip, ratio: number): number {
  return Math.max(0, Math.min(strip.frameCount - 1, Math.floor(ratio * strip.frameCount)));
}

function forgetFailureSoALaterRenderRetries<T>(cache: Map<string, Promise<T>>, assetId: string): null {
  cache.delete(assetId);
  return null;
}

export function filmstripFor(asset: AssetRef): Promise<Filmstrip | null> {
  let cached = filmstripCache.get(asset.id);
  if (!cached) {
    const seconds = (asset.durationMs ?? 4000) / 1000;
    const frameCount = Math.max(8, Math.min(48, Math.ceil(seconds)));
    cached = getFilmstrip(asset.src, { frameCount, frameWidth: 96 })
      .then((strip) => {
        resolvedFilmstrips.set(asset.id, strip);
        return strip;
      })
      .catch(() => forgetFailureSoALaterRenderRetries(filmstripCache, asset.id));
    filmstripCache.set(asset.id, cached);
  }
  return cached;
}

export function peaksFor(asset: AssetRef): Promise<AudioPeaks | null> {
  let cached = peaksCache.get(asset.id);
  if (!cached) {
    const seconds = (asset.durationMs ?? 4000) / 1000;
    cached = extractAudioPeaks(asset.src, {
      buckets: Math.max(200, Math.min(4000, Math.round(seconds * 50))),
    })
      .then((peaks) => {
        resolvedPeaks.set(asset.id, peaks);
        return peaks;
      })
      .catch(() => forgetFailureSoALaterRenderRetries(peaksCache, asset.id));
    peaksCache.set(asset.id, cached);
  }
  return cached;
}

export function evictClipMediaCache(assetId: string): void {
  filmstripCache.delete(assetId);
  resolvedFilmstrips.delete(assetId);
  peaksCache.delete(assetId);
  resolvedPeaks.delete(assetId);
}

export function VideoFilmstrip({
  asset,
  widthPx,
  heightPx,
  trimStartMs,
  durationMs,
  timeMap,
  reversed,
  className,
}: {
  asset: AssetRef;
  widthPx: number;
  heightPx: number;
  trimStartMs: number;
  durationMs: number;
  timeMap?: TimeMap;
  reversed?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useIsomorphicLayoutEffect(() => {
    let cancelled = false;
    const draw = (strip: Filmstrip | null) => {
      if (cancelled || !strip) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const width = Math.max(1, Math.round(widthPx));
      const height = Math.max(1, Math.round(heightPx));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const assetDurationMs = asset.durationMs ?? Math.max(1, trimStartMs + durationMs);
      const tileWidth = Math.max(8, (strip.frameWidth / strip.frameHeight) * height);
      const clip = { startMs: 0, durationMs, trimStartMs, timeMap, reversed };
      for (let x = 0; x < width; x += tileWidth) {
        const sourceMs = getSourceTimeMs(clip, (x / width) * durationMs);
        const index = filmstripFrameIndex(strip, sourceMs / assetDurationMs);
        ctx.drawImage(
          strip.canvas,
          index * strip.frameWidth,
          0,
          strip.frameWidth,
          strip.frameHeight,
          x,
          0,
          tileWidth,
          height,
        );
      }
      setReady(true);
    };
    const resolved = resolvedFilmstrips.get(asset.id);
    if (resolved !== undefined) draw(resolved);
    else void filmstripFor(asset).then(draw);
    return () => {
      cancelled = true;
    };
  }, [asset, widthPx, heightPx, trimStartMs, durationMs, timeMap, reversed]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "pointer-events-none absolute inset-0 size-full",
        !ready && "animate-pulse bg-overlay-foreground/10",
        className,
      )}
    />
  );
}

export function AudioWaveform({
  asset,
  widthPx,
  heightPx,
  trimStartMs,
  durationMs,
  timeMap,
  reversed,
  className,
  color = "rgba(255, 255, 255, 0.85)",
  variant = "full",
}: {
  asset: AssetRef;
  widthPx: number;
  heightPx: number;
  trimStartMs: number;
  durationMs: number;
  timeMap?: TimeMap;
  reversed?: boolean;
  className?: string;
  color?: string;
  variant?: "full" | "strip";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    let cancelled = false;
    const draw = (result: AudioPeaks | null) => {
      if (cancelled || !result) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const width = Math.max(1, Math.round(widthPx));
      const height = Math.max(1, Math.round(heightPx));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { peaks } = result;
      const assetDurationMs = asset.durationMs ?? result.durationMs;
      const mid = height / 2;
      ctx.fillStyle = color;
      const barWidth = 2;
      const gap = 1;
      const clip = { startMs: 0, durationMs, trimStartMs, timeMap, reversed };
      for (let x = 0; x < width; x += barWidth + gap) {
        const sourceMs = getSourceTimeMs(clip, (x / width) * durationMs);
        const bucket = Math.max(
          0,
          Math.min(peaks.length - 1, Math.floor((sourceMs / assetDurationMs) * peaks.length)),
        );
        const amplitude = Math.max(0.06, peaks[bucket] ?? 0);
        const barHeight = amplitude * (height - 4);
        ctx.fillRect(x, mid - barHeight / 2, barWidth, barHeight);
      }
    };
    const resolved = resolvedPeaks.get(asset.id);
    if (resolved !== undefined) draw(resolved);
    else void peaksFor(asset).then(draw);
    return () => {
      cancelled = true;
    };
  }, [asset, widthPx, heightPx, trimStartMs, durationMs, timeMap, reversed, color]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "pointer-events-none absolute",
        variant === "strip" ? "inset-x-0 bottom-0" : "inset-0 size-full",
        className,
      )}
      style={variant === "strip" ? { height: heightPx } : undefined}
    />
  );
}
