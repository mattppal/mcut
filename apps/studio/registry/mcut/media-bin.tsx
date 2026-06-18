"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useMutation } from "@tanstack/react-query";
import {
  DownloadIcon,
  FileVideoIcon,
  MusicIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "@/lib/hugeicons";
import { toast } from "sonner";
import { getVideoThumbnailUrl } from "@mcut/media";
import { useEditor, useProject } from "@mcut/react";
import type { AssetRef } from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { evictClipMediaCache, filmstripFor } from "./clip-media";
import {
  elementForAsset,
  insertElementAtPlayhead,
  insertElementOnNewTrack,
} from "./editor-actions";
import type { EditorDragData } from "./editor-dnd";
import { useEditorUI } from "./editor-ui";
import { PanelHeader, PanelSectionLabel, Spinner } from "./editor-primitives";
import { formatDurationBadge } from "./format";
import { importMediaFiles, type OnAssetImported } from "./media-import";

export type { OnAssetImported } from "./media-import";

async function downloadAsset(asset: AssetRef): Promise<void> {
  const response = await fetch(asset.src);
  if (!response.ok) throw new Error("Could not read the asset");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = asset.name ?? `${asset.kind}.${asset.kind === "image" ? "png" : "bin"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function thumbnailTimeMs(asset: AssetRef): number {
  if (!asset.durationMs) return 0;
  const nearStart = Math.max(250, Math.round(asset.durationMs * 0.05));
  return Math.min(nearStart, 2000, Math.max(0, asset.durationMs - 1));
}

function revokeThumbnail(url: string | null | undefined): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

/** Video tile that scrubs through cached filmstrip frames on hover. */
function VideoScrubThumb({ asset, thumb }: { asset: AssetRef; thumb?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const drawFrame = (ratio: number) => {
    void filmstripFor(asset).then((strip) => {
      const canvas = canvasRef.current;
      if (!strip || !canvas) return;
      const index = Math.max(
        0,
        Math.min(strip.frameCount - 1, Math.floor(ratio * strip.frameCount)),
      );
      canvas.width = strip.frameWidth;
      canvas.height = strip.frameHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(
        strip.canvas,
        index * strip.frameWidth,
        0,
        strip.frameWidth,
        strip.frameHeight,
        0,
        0,
        strip.frameWidth,
        strip.frameHeight,
      );
      setScrubbing(true);
    });
  };

  return (
    <div
      className="relative size-full"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        drawFrame((event.clientX - rect.left) / rect.width);
      }}
      onMouseLeave={() => setScrubbing(false)}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt={asset.name ?? "video"} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <FileVideoIcon className="size-5" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={cn(
          "pointer-events-none absolute inset-0 size-full object-cover",
          !scrubbing && "hidden",
        )}
      />
    </div>
  );
}

function AssetThumb({ asset, thumb }: { asset: AssetRef; thumb?: string }) {
  if (asset.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={asset.src} alt={asset.name ?? "image"} className="size-full object-cover" />;
  }
  if (asset.kind === "video") {
    return <VideoScrubThumb asset={asset} thumb={thumb} />;
  }
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground">
      <MusicIcon className="size-5" />
    </div>
  );
}

function AssetCard({
  asset,
  thumb,
  selected,
  onAdd,
  onRemove,
  onSave,
  onToggleSelect,
}: {
  asset: AssetRef;
  thumb?: string;
  selected: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onSave: () => void;
  onToggleSelect: () => void;
}) {
  const dragData: EditorDragData = { kind: "asset", asset, ...(thumb ? { thumb } : {}) };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset-${asset.id}`,
    data: dragData,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className={cn(
              "group relative cursor-grab touch-none overflow-hidden rounded-lg bg-muted transition-shadow hover:ring-1 hover:ring-primary/40",
              selected && "ring-2 ring-primary hover:ring-2",
              isDragging && "opacity-40",
            )}
            onClick={onToggleSelect}
            onDoubleClick={onAdd}
            title={`${asset.name ?? asset.kind} — drag to the timeline, click to select`}
          />
        }
      >
        <div className="relative aspect-video w-full overflow-hidden bg-overlay/50">
          <AssetThumb asset={asset} thumb={thumb} />
          {asset.durationMs !== undefined && (
            <Badge
              variant="secondary"
              className="absolute right-1 bottom-1 bg-overlay/70 px-1 font-mono text-2xs text-overlay-foreground"
            >
              {formatDurationBadge(asset.durationMs)}
            </Badge>
          )}
          {selected && (
            <span className="absolute top-1 left-1 flex size-4 items-center justify-center rounded-full bg-primary text-2xs text-primary-foreground">
              ✓
            </span>
          )}
        </div>
        <p className="truncate p-1.5 pb-1 text-2xs leading-tight">{asset.name ?? asset.kind}</p>
        <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="icon-xs"
            title="Add at playhead"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onAdd}
          >
            <PlusIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="destructive"
            title="Remove asset and its clips"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onAdd}>
          <PlusIcon /> Add at playhead
        </ContextMenuItem>
        <ContextMenuItem onClick={onSave}>
          <DownloadIcon /> Save as…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onRemove}>
          <Trash2Icon /> Remove asset
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Media bin: dropzone + picker import (Mediabunny probing), searchable grid,
 * cards that drag onto the timeline (dnd-kit) or double-click to place at
 * the playhead.
 */
export function MediaBin({
  className,
  onAssetImported,
}: {
  className?: string;
  onAssetImported?: OnAssetImported;
}) {
  const engine = useEditor();
  const project = useProject();
  const { setMode } = useEditorUI();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingThumbIdsRef = useRef(new Set<string>());
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState("");
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  /** Click-selected asset ids, in click order. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Pair signature ("idA+idB") whose screen/camera roles are flipped. */
  const [swappedPair, setSwappedPair] = useState("");

  const toggleSelect = (assetId: string) => {
    setSelectedIds((ids) =>
      ids.includes(assetId) ? ids.filter((id) => id !== assetId) : [...ids, assetId],
    );
  };

  // Two selected videos propose a multicam: wider asset starts as the screen.
  const selectedVideos = selectedIds
    .map((id) => project.assets[id])
    .filter((a): a is AssetRef => Boolean(a && a.kind === "video"));
  const pair = selectedVideos.length === 2 ? selectedVideos : null;
  const pairKey = pair ? pair.map((a) => a.id).join("+") : "";
  const aspect = (a: AssetRef) => (a.width && a.height ? a.width / a.height : 0);
  const widerFirst = pair
    ? aspect(pair[0]!) >= aspect(pair[1]!)
      ? pair
      : [pair[1]!, pair[0]!]
    : null;
  const roles =
    widerFirst &&
    (swappedPair === pairKey
      ? { screen: widerFirst[1]!, camera: widerFirst[0]! }
      : { screen: widerFirst[0]!, camera: widerFirst[1]! });
  const allAssets = useMemo(() => Object.values(project.assets), [project.assets]);

  useEffect(() => {
    const videoAssets = allAssets.filter((asset) => asset.kind === "video");

    for (const asset of videoAssets) {
      if (thumbs[asset.id] !== undefined || pendingThumbIdsRef.current.has(asset.id)) continue;
      pendingThumbIdsRef.current.add(asset.id);
      void getVideoThumbnailUrl(asset.src, { width: 320, timeMs: thumbnailTimeMs(asset) })
        .then((url) => {
          setThumbs((current) => {
            if (!engine.project.assets[asset.id]) {
              revokeThumbnail(url);
              return current;
            }
            return { ...current, [asset.id]: url };
          });
        })
        .catch(() => {
          setThumbs((current) => ({ ...current, [asset.id]: null }));
        })
        .finally(() => {
          pendingThumbIdsRef.current.delete(asset.id);
        });
    }
  }, [allAssets, engine, thumbs]);

  const createMulticamFromBin = () => {
    if (!roles) return;
    const { screen, camera } = roles;
    const startMs = Math.round(engine.playback.state.currentTimeMs);
    try {
      engine.transact(() => {
        // New tracks stack on top, so the screen goes in first (bottom layer).
        const screenId = insertElementOnNewTrack(engine, elementForAsset(engine, screen), startMs);
        const cameraId = insertElementOnNewTrack(engine, elementForAsset(engine, camera), startMs);
        engine.dispatch({ type: "createMulticam", elementIds: [screenId, cameraId] });
      });
      setSelectedIds([]);
      setMode("multicam");
      toast.success("Multicam created — click the layout tiles (or press 1–9) to switch");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the multicam");
    }
  };

  const importFiles = useMutation({
    mutationFn: (files: File[]) =>
      importMediaFiles(engine, files, (asset, file) => {
        onAssetImported?.(asset, file);
      }),
    onSuccess: (imported) => {
      if (imported.length > 0) {
        toast.success(`Imported ${imported.length} file${imported.length > 1 ? "s" : ""}`);
      }
    },
  });

  const removeAsset = (asset: AssetRef) => {
    engine.dispatch({ type: "removeAsset", assetId: asset.id });
    evictClipMediaCache(asset.id);
    setThumbs((current) => {
      const url = current[asset.id];
      if (url === undefined) return current;
      revokeThumbnail(url);
      const next = { ...current };
      delete next[asset.id];
      return next;
    });
    if (asset.src.startsWith("blob:")) URL.revokeObjectURL(asset.src);
  };

  const saveAssetAs = async (asset: AssetRef) => {
    try {
      await downloadAsset(asset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save asset");
    }
  };

  const assets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allAssets.filter((a) => (a.name ?? a.kind).toLowerCase().includes(q)) : allAssets;
  }, [allAssets, query]);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) importFiles.mutate(files);
  };

  const isFileDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col transition-colors",
        isFileDragOver && "bg-primary/5 ring-1 ring-primary/30 ring-inset",
        className,
      )}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setIsFileDragOver(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFileDragOver(false);
        }
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setIsFileDragOver(false);
        handleFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.mkv"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          handleFiles(files);
          e.target.value = "";
        }}
      />
      <PanelHeader>
        <PanelSectionLabel>Media</PanelSectionLabel>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          title="Import media"
          disabled={importFiles.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {importFiles.isPending ? <Spinner /> : <PlusIcon />} Import
        </Button>
      </PanelHeader>
      {Object.keys(project.assets).length > 3 && (
        <div className="shrink-0 px-2 pb-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="Search media"
              className="h-7 pl-7 text-xs"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {Object.keys(project.assets).length === 0 ? (
        <button
          type="button"
          disabled={importFiles.isPending}
          className="mx-2 mb-2 flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-lg p-6 text-center text-xs text-muted-foreground transition-colors hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-60"
          onClick={() => inputRef.current?.click()}
        >
          <div className="flex size-8 items-center justify-center rounded-md bg-muted">
            {importFiles.isPending ? <Spinner /> : <UploadIcon className="size-4" />}
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">
              {importFiles.isPending ? "Importing media" : "Upload media"}
            </span>
            <span>Drop video, audio, or images anywhere in this panel</span>
          </div>
        </button>
      ) : (
        // The grid scrolls under the pinned header/search, so a top fade is earned.
        <ScrollArea className="min-h-0 flex-1 scroll-mask-y">
          <div className="grid grid-cols-2 gap-1.5 p-2 pt-0.5">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                thumb={thumbs[asset.id] ?? undefined}
                selected={selectedIds.includes(asset.id)}
                onAdd={() => insertElementAtPlayhead(engine, elementForAsset(engine, asset))}
                onRemove={() => removeAsset(asset)}
                onSave={() => void saveAssetAs(asset)}
                onToggleSelect={() => toggleSelect(asset.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {roles ? (
        <div data-mcut-multicam-setup="" className="shrink-0 border-t p-2">
          <PanelSectionLabel>New multicam</PanelSectionLabel>
          <div className="mt-1.5 flex flex-col gap-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">Screen</span>
              <span className="truncate">{roles.screen.name ?? "video"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-muted-foreground">Camera</span>
              <span className="truncate">{roles.camera.name ?? "video"}</span>
            </div>
          </div>
          <div className="mt-2 flex gap-1.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => setSwappedPair(swappedPair === pairKey ? "" : pairKey)}
            >
              Swap roles
            </Button>
            <Button size="xs" onClick={createMulticamFromBin}>
              Create multicam
            </Button>
          </div>
        </div>
      ) : (
        selectedVideos.length === 1 && (
          <p className="shrink-0 border-t p-2 text-2xs text-muted-foreground">
            1 video selected — select your other recording to set up a multicam.
          </p>
        )
      )}
    </div>
  );
}
