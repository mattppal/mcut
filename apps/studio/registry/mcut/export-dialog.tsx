"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DownloadIcon, TriangleAlertIcon } from "@/lib/hugeicons";
import {
  exportProject,
  getExportSupport,
  listContainerFormats,
  type ContainerFormatId,
  type ExportProgress,
} from "@mcut/media";
import { useEditor, useEditorState } from "@mcut/react";
import { getProjectDurationMs } from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "./editor-primitives";
import { collectProjectFontExports, ensureProjectFontsLoaded } from "./font-library";

const PHASE_LABEL: Record<ExportProgress["phase"], string> = {
  audio: "Mixing audio",
  video: "Rendering frames",
  finalize: "Finalizing file",
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Deterministic client-side export: the shared compositor renders every
 * frame from exact decoded samples, WebCodecs encodes, Mediabunny muxes.
 */
export function ExportDialog() {
  const engine = useEditor();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ContainerFormatId>("mp4");
  const formats = listContainerFormats();
  const formatLabel = formats.find((f) => f.id === format)?.label ?? format.toUpperCase();
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const durationMs = useEditorState((s) => getProjectDurationMs(s.project));
  const projectName = useEditorState((s) => s.project.name);

  const support = useQuery({
    queryKey: ["mcut-export-support", format],
    queryFn: () => getExportSupport(format),
    enabled: open,
    staleTime: Infinity,
  });

  const abortRef = useRef<AbortController | null>(null);
  const exportMutation = useMutation({
    mutationFn: async () => {
      setProgress({ progress: 0, phase: "audio" });
      engine.pause();
      const controller = new AbortController();
      abortRef.current = controller;
      // Text frames render with whatever face is loaded — make sure every
      // referenced font is in document.fonts (main-thread fallback path) and
      // collect the faces the export worker registers in its own scope.
      await ensureProjectFontsLoaded(engine.project);
      const fonts = await collectProjectFontExports(engine.project);
      return exportProject(engine.project, {
        format,
        fonts,
        onProgress: setProgress,
        signal: controller.signal,
      });
    },
    onSuccess: (result) => {
      downloadBlob(result.blob, `${projectName || "export"}.${result.extension}`);
      setProgress(null);
    },
    onError: () => setProgress(null),
    onSettled: () => {
      abortRef.current = null;
    },
  });
  const exportError =
    exportMutation.isError && !(exportMutation.error instanceof DOMException && exportMutation.error.name === "AbortError")
      ? exportMutation.error
      : null;

  const busy = exportMutation.isPending;
  const unsupported = support.data ? !support.data.video : false;

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={durationMs === 0}
        title="Export video"
        data-mcut-export-trigger=""
      >
        <DownloadIcon /> Export
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Export video</DialogTitle>
            <DialogDescription>
              Rendered entirely in your browser with WebCodecs — nothing is uploaded.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="w-16 text-xs text-muted-foreground">Format</span>
              <div className="flex flex-1 gap-1">
                {formats.map((option) => (
                  <Button
                    key={option.id}
                    size="xs"
                    variant={format === option.id ? "secondary" : "ghost"}
                    className={cn("flex-1", format === option.id && "font-semibold")}
                    disabled={busy}
                    onClick={() => setFormat(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {unsupported && (
              <p className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                This browser can&apos;t encode {formatLabel} with WebCodecs. Try Chrome or
                Edge, or switch formats.
              </p>
            )}
            {support.data && support.data.video && !support.data.audio && (
              <p className="text-xs text-muted-foreground">
                Audio encoding is unavailable in this browser; the export will be silent.
              </p>
            )}

            {busy && progress && (
              <div className="flex flex-col gap-2">
                <Progress value={Math.round(progress.progress * 100)} />
                <p className="text-center text-xs text-muted-foreground">
                  {PHASE_LABEL[progress.phase]} — {Math.round(progress.progress * 100)}%
                </p>
              </div>
            )}

            {exportError && (
              <p className="text-xs text-destructive">
                Export failed: {exportError instanceof Error ? exportError.message : "unknown error"}
              </p>
            )}
          </div>

          <DialogFooter>
            {busy ? (
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            )}
            <Button disabled={busy || unsupported || durationMs === 0} onClick={() => exportMutation.mutate()}>
              {busy ? <Spinner /> : <DownloadIcon />}
              {busy ? "Exporting…" : `Export ${formatLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
