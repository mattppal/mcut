"use client";

import { useEffect, useRef } from "react";
import { renderFrame } from "@mcut/compositor";
import { useEditorContext, useEditorState, usePlayback, useSelection } from "@mcut/react";
import { getActiveAngleIndex, type Layout, type MulticamElement, type Project } from "@mcut/timeline";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelSectionLabel } from "./editor-primitives";
import { findTargetMulticam, switchToLayout } from "./multicam-ui";
import { useEditorUI } from "./editor-ui";

/**
 * The multicam layout bank (Premiere's angle monitor adapted to layouts):
 * one live tile per project layout. Click or press 1–9 — while playing it
 * CUTS at the playhead; while paused it CORRECTS the span under it.
 */

const TILE_FPS_MS = 120; // ~8fps live tiles — smooth enough, cheap enough

function projectWithForcedLayout(
  project: Project,
  multicam: MulticamElement,
  layoutId: string,
): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      elements: track.elements.map((element) =>
        element.id === multicam.id && element.type === "multicam"
          ? { ...element, angles: [{ atMs: 0, layoutId }] }
          : element,
      ),
    })),
  };
}

function LayoutTile({
  project,
  multicam,
  layout,
  index,
  active,
}: {
  project: Project;
  multicam: MulticamElement;
  layout: Layout;
  index: number;
  active: boolean;
}) {
  const { engine, pool } = useEditorContext();
  const { editingLayoutId, setEditingLayoutId } = useEditorUI();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDrawRef = useRef(0);

  // Live tile: redraw from the shared preview pool, throttled.
  const tick = usePlayback((s) => Math.floor(s.currentTimeMs / TILE_FPS_MS));
  useEffect(() => {
    void tick;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const now = performance.now();
    if (now - lastDrawRef.current < TILE_FPS_MS / 2) return;
    lastDrawRef.current = now;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const forced = projectWithForcedLayout(project, multicam, layout.id);
    ctx.save();
    ctx.scale(canvas.width / project.width, canvas.height / project.height);
    renderFrame(ctx, forced, engine.playback.state.currentTimeMs, { source: pool });
    ctx.restore();
  });

  return (
    <button
      type="button"
      title={`${layout.name} — ${index + 1} cuts while playing, corrects while paused`}
      className={cn(
        "group relative w-full overflow-hidden rounded-lg text-left transition-shadow",
        active ? "ring-2 ring-primary" : "ring-1 ring-foreground/10 hover:ring-foreground/30",
      )}
      onClick={() => switchToLayout(engine, multicam, layout.id)}
    >
      <canvas
        ref={canvasRef}
        width={192}
        height={Math.round((192 * project.height) / project.width)}
        className="block w-full"
      />
      <span className="absolute top-1 left-1 rounded-sm bg-overlay/65 px-1 font-mono text-2xs text-overlay-foreground">
        {index + 1}
      </span>
      <span className="absolute right-1 bottom-1 left-1 truncate rounded-sm bg-overlay/55 px-1 py-0.5 text-2xs text-overlay-foreground/90">
        {layout.name}
      </span>
      <span
        role="button"
        tabIndex={-1}
        title={editingLayoutId === layout.id ? "Stop editing slots" : "Edit slots on the canvas"}
        className={cn(
          "absolute top-1 right-1 hidden rounded-sm bg-overlay/65 px-1 text-2xs text-overlay-foreground/90 group-hover:block",
          editingLayoutId === layout.id && "block bg-primary text-primary-foreground",
        )}
        onClick={(event) => {
          event.stopPropagation();
          setEditingLayoutId(editingLayoutId === layout.id ? null : layout.id);
        }}
      >
        ✎
      </span>
    </button>
  );
}

export function LayoutBank({ className }: { className?: string }) {
  const { engine } = useEditorContext();
  const project = useEditorState((s) => s.project);
  const selection = useSelection();
  const playheadMs = usePlayback((s) => s.currentTimeMs);
  const target = findTargetMulticam(project, selection.elementIds, playheadMs);

  if (!target) {
    const selectedVideos = selection.elementIds.filter((id) =>
      project.tracks.some((t) => t.elements.some((e) => e.id === id && e.type === "video")),
    );
    const count = selectedVideos.length;
    return (
      <div
        className={cn(
          "flex w-48 shrink-0 flex-col justify-center gap-2 p-3 text-xs text-muted-foreground",
          className,
        )}
      >
        <p className="font-medium text-foreground">No multicam yet</p>
        <p>
          Fastest: in the Media bin, click your screen and camera videos — a “New multicam”
          panel appears where you pick which is which.
        </p>
        <p>From the timeline instead: select both clips (click one, shift-click the other), then:</p>
        <Button
          size="xs"
          disabled={count === 0}
          onClick={() => {
            try {
              engine.dispatch({ type: "createMulticam", elementIds: selectedVideos });
            } catch {
              // Selection changed underneath: state resyncs.
            }
          }}
        >
          Create multicam
        </Button>
        <p className="text-2xs">
          {count === 0
            ? "Nothing selected on the timeline yet — selecting files in the media bin doesn't count."
            : count === 1
              ? "1 clip selected — shift-click the other to get screen + camera."
              : count === 2
                ? "2 clips selected — bottom layer becomes the screen, top layer the camera. Swap roles anytime in the properties panel."
                : `${count} clips selected — assign roles in the properties panel after creating.`}
        </p>
      </div>
    );
  }

  const localMs = playheadMs - target.element.startMs;
  const activeIndex = getActiveAngleIndex(target.element.angles, localMs);
  const activeLayoutId = target.element.angles[activeIndex]?.layoutId;

  return (
    <div className={cn("flex w-48 shrink-0 flex-col gap-2 overflow-y-auto scroll-mask-b p-2", className)}>
      <PanelSectionLabel>Layouts · 1–{Math.min(9, project.layouts.length)}</PanelSectionLabel>
      {project.layouts.map((layout, index) => (
        <LayoutTile
          key={layout.id}
          project={project}
          multicam={target.element}
          layout={layout}
          index={index}
          active={layout.id === activeLayoutId}
        />
      ))}
    </div>
  );
}
