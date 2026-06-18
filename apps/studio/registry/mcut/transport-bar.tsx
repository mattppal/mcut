"use client";

import { useState } from "react";
import {
  CameraIcon,
  CheckIcon,
  ChevronFirstIcon,
  ChevronLastIcon,
  EyeIcon,
  MagnetIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  RatioIcon,
  StepBackIcon,
  StepForwardIcon,
  Volume2Icon,
  VolumeXIcon,
} from "@/lib/hugeicons";
import { toast } from "sonner";
import { useEditorContext, useEditorState, usePlayback, type PreviewQuality } from "@mcut/react";
import { getProjectDurationMs } from "@mcut/timeline";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditorUI, type TimelineEditMode, type TimelineTool } from "./editor-ui";
import { formatTimecode } from "./format";
import { captureViewportStill } from "./viewport-capture";

/** Premiere-style pointer tools; letters double as their shortcuts. */
const TIMELINE_TOOLS: Array<{ id: TimelineTool; label: string; hint: string; key: string }> = [
  { id: "select", label: "Select", hint: "move / trim", key: "V" },
  { id: "ripple", label: "Ripple", hint: "trim + close gaps", key: "B" },
  { id: "roll", label: "Roll", hint: "move the cut", key: "R" },
  { id: "slip", label: "Slip", hint: "shift source in place", key: "Y" },
  { id: "slide", label: "Slide", hint: "move between neighbors", key: "U" },
];

const EDIT_MODES: Array<{ id: TimelineEditMode; label: string; hint: string }> = [
  { id: "normal", label: "Normal", hint: "drops never collide" },
  { id: "overwrite", label: "Overwrite", hint: "drops clear their landing range" },
  { id: "insert", label: "Insert", hint: "drops ripple everything right" },
];

const ASPECT_PRESETS = [
  { label: "16:9 — Landscape", width: 1920, height: 1080 },
  { label: "9:16 — Portrait", width: 1080, height: 1920 },
  { label: "1:1 — Square", width: 1080, height: 1080 },
  { label: "4:5 — Social", width: 1080, height: 1350 },
  { label: "21:9 — Cinema", width: 2560, height: 1080 },
];

/** Preview-only raster quality (export always renders full resolution). */
const QUALITY_PRESETS: Array<{ label: string; hint: string; value: PreviewQuality }> = [
  { label: "Auto", hint: "fit preview", value: "auto" },
  { label: "720p", hint: "performance", value: 720 },
  { label: "1080p", hint: "balanced", value: 1080 },
  { label: "Full", hint: "project size", value: "full" },
];

const CAPTURE_PRESETS = [
  { label: "Project resolution", hint: "1x", scale: 1 },
  { label: "High resolution", hint: "2x", scale: 2 },
  { label: "Ultra high resolution", hint: "4x", scale: 4 },
];

function IconButton({
  label,
  shortcut,
  onClick,
  active,
  children,
  disabled,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function Timecode() {
  const currentTimeMs = usePlayback((s) => s.currentTimeMs);
  const durationMs = useEditorState((s) => getProjectDurationMs(s.project));
  return (
    <span className="min-w-30 text-center font-mono text-xs tabular-nums text-muted-foreground select-none">
      <span className="text-foreground">{formatTimecode(currentTimeMs)}</span>
      <span className="px-0.5 opacity-50">/</span>
      {formatTimecode(durationMs)}
    </span>
  );
}

/**
 * CapCut-style transport strip under the preview: skip/step/play, timecode,
 * aspect presets, snap magnet, mute, fullscreen.
 */
export function TransportBar() {
  const { engine, pool } = useEditorContext();
  const isPlaying = usePlayback((s) => s.isPlaying);
  const muted = usePlayback((s) => s.muted);
  const fps = useEditorState((s) => s.project.fps);
  const {
    snapEnabled,
    setSnapEnabled,
    timelineTool,
    setTimelineTool,
    editMode,
    setEditMode,
    autoCrossfade,
    setAutoCrossfade,
    previewQuality,
    setPreviewQuality,
  } = useEditorUI();
  const [capturingScale, setCapturingScale] = useState<number | null>(null);
  const frameMs = 1000 / fps;

  const seekBy = (deltaMs: number) =>
    engine.seek(engine.playback.state.currentTimeMs + deltaMs);

  const captureStill = async (scale: number) => {
    setCapturingScale(scale);
    try {
      const still = await captureViewportStill(engine, { source: pool, scale });
      toast.success(
        `Captured ${still.width}×${still.height} still to the media bin`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not capture still");
    } finally {
      setCapturingScale(null);
    }
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 px-2">
      <div className="mr-1 flex items-center gap-px rounded-md bg-muted/40 p-0.5">
        {TIMELINE_TOOLS.map((tool) => (
          <Tooltip key={tool.id}>
            <TooltipTrigger
              render={
                <Button
                  variant={timelineTool === tool.id ? "secondary" : "ghost"}
                  size="icon-sm"
                  className="size-6 font-mono text-2xs"
                  onClick={() => setTimelineTool(tool.id)}
                  aria-label={`${tool.label} tool`}
                />
              }
            >
              {tool.key}
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-1.5">
              {tool.label} — {tool.hint}
              <Kbd>{tool.key}</Kbd>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <IconButton
        label={snapEnabled ? "Snapping on" : "Snapping off"}
        shortcut="N"
        active={snapEnabled}
        onClick={() => setSnapEnabled(!snapEnabled)}
      >
        <MagnetIcon />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={editMode === "normal" ? "ghost" : "secondary"}
              size="sm"
              className="h-7 px-2 font-mono text-2xs uppercase"
              aria-label="Edit mode"
              title="Edit mode for drops and inserts"
            />
          }
        >
          {editMode}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Edit mode</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {EDIT_MODES.map((mode) => (
            <DropdownMenuItem key={mode.id} onClick={() => setEditMode(mode.id)}>
              {editMode === mode.id ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <span className="size-3.5" />
              )}
              {mode.label}
              <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">
                {mode.hint}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAutoCrossfade(!autoCrossfade)}>
            {autoCrossfade ? <CheckIcon className="size-3.5" /> : <span className="size-3.5" />}
            Auto-crossfade
            <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">
              dissolve on push
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Canvas size" title="Canvas size" />}
        >
          <RatioIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Canvas</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ASPECT_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.label}
              onClick={() =>
                engine.dispatch({
                  type: "updateProject",
                  width: preset.width,
                  height: preset.height,
                })
              }
            >
              {preset.label}
              <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">
                {preset.width}×{preset.height}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Preview quality"
              title="Preview quality"
            />
          }
        >
          <EyeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Preview quality</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {QUALITY_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.label} onClick={() => setPreviewQuality(preset.value)}>
              {previewQuality === preset.value ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <span className="size-3.5" />
              )}
              {preset.label}
              <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">
                {preset.hint}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex flex-1 items-center justify-center gap-0.5">
        <IconButton label="Go to start" onClick={() => engine.seek(0)}>
          <ChevronFirstIcon />
        </IconButton>
        <IconButton label="Previous frame" shortcut="←" onClick={() => seekBy(-frameMs)}>
          <StepBackIcon />
        </IconButton>
        <IconButton
          label={isPlaying ? "Pause" : "Play"}
          shortcut="Space"
          onClick={() => (isPlaying ? engine.pause() : engine.play())}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground [&_svg]:size-3.5">
            {isPlaying ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </span>
        </IconButton>
        <IconButton label="Next frame" shortcut="→" onClick={() => seekBy(frameMs)}>
          <StepForwardIcon />
        </IconButton>
        <IconButton
          label="Go to end"
          onClick={() => engine.seek(getProjectDurationMs(engine.project))}
        >
          <ChevronLastIcon />
        </IconButton>
        <Timecode />
      </div>

      <IconButton label={muted ? "Unmute" : "Mute"} onClick={() => engine.setMuted(!muted)}>
        {muted ? <VolumeXIcon className="text-destructive" /> : <Volume2Icon />}
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Capture still"
              title="Capture still"
              disabled={capturingScale !== null}
            />
          }
        >
          <CameraIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Capture still</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CAPTURE_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.scale}
              disabled={capturingScale !== null}
              onClick={() => void captureStill(preset.scale)}
            >
              {preset.label}
              <span className="ml-auto pl-3 font-mono text-2xs text-muted-foreground">
                {capturingScale === preset.scale ? "saving" : preset.hint}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        label="Fullscreen preview"
        onClick={() => {
          document.querySelector("[data-mcut-player]")?.requestFullscreen?.().catch(() => {});
        }}
      >
        <MaximizeIcon />
      </IconButton>
    </div>
  );
}
