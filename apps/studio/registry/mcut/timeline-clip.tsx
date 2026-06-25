"use client";

// Timeline clips: filmstrip/waveform media, multicam cut ticks, trim handles, and the clip context menu.

import { memo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { LinkIcon } from "@/lib/hugeicons";
import { useEditor, useEditorState } from "@mcut/react";
import {
  getAverageSpeed,
  getGroupedElementIds,
  getLinkedElementIds,
  listTransitionTypes,
  type AssetRef,
  type TimelineElement,
  type Track,
} from "@mcut/timeline";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AudioWaveform, VideoFilmstrip } from "./clip-media";
import { FadeOverlay } from "./clip-fades";
import { getElementUI } from "./element-ui";
import { KeyframeMarkers, VolumeBand } from "./clip-keyframes";
import {
  duplicateElement,
  removeSelection,
  splitSelectionAtPlayhead,
  unlinkElements,
} from "./editor-actions";
import { useEditorUI } from "./editor-ui";
import { TRACK_HEIGHT, useClipDrag, type ClipDragMode } from "./timeline-drag";

const TRIM_HANDLE_PX = 9;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clipLabel(element: TimelineElement, asset?: AssetRef): string {
  if (element.type === "text" || element.type === "caption") return element.text;
  if (element.type === "multicam") {
    return `Multicam (${element.sources.map((s) => s.key).join(" + ")})`;
  }
  return asset?.name ?? element.type;
}

function isFlatFreezeVideo(element: TimelineElement): boolean {
  if (element.type !== "video" || !element.timeMap || element.timeMap.length < 2) return false;
  const value = element.timeMap[0]!.value;
  return element.timeMap.every((frame) => frame.value === value);
}

function canTrimFromTimeline(element: TimelineElement): boolean {
  if (!element.groupId) return true;
  return element.type === "video" && !isFlatFreezeVideo(element);
}

// ---------------------------------------------------------------------------
// Clip
// ---------------------------------------------------------------------------

// Clip-type color tokens live in globals.css under [data-editor]; alpha is
// baked into the tokens, so no opacity modifiers here.

/**
 * Waveform of the multicam's playing audio: the source named by
 * `audioSource` (all sources are muted when it's unset, so draw nothing).
 */
function MulticamWaveform({
  element,
  widthPx,
  heightPx,
}: {
  element: TimelineElement & { type: "multicam" };
  widthPx: number;
  heightPx: number;
}) {
  const source = element.sources.find((s) => s.key === element.audioSource);
  const asset = useEditorState((s) => (source ? s.project.assets[source.assetId] : undefined));
  if (!source || !asset) return null;
  return (
    <AudioWaveform
      asset={asset}
      widthPx={widthPx}
      heightPx={Math.round(heightPx * 0.35)}
      trimStartMs={source.trimStartMs}
      durationMs={element.durationMs}
      timeMap={element.timeMap}
      variant="strip"
      color="rgba(255, 255, 255, 0.65)"
    />
  );
}

/**
 * Multicam clip internals: one label per cut span (the layout it shows) and
 * a draggable tick at every cut. Drag retimes (moveAngleCut, one undo per
 * gesture); alt-click removes the cut.
 */
function MulticamCutTicks({
  element,
  pxPerMs,
}: {
  element: TimelineElement & { type: "multicam" };
  pxPerMs: number;
}) {
  const engine = useEditor();
  const layouts = useEditorState((s) => s.project.layouts);
  const dragRef = useRef<{ fromMs: number; startClientX: number } | null>(null);

  const layoutName = (layoutId: string) =>
    layouts.find((l) => l.id === layoutId)?.name ?? "?";

  return (
    <>
      {element.angles.map((cut, i) => {
        const nextAt = element.angles[i + 1]?.atMs ?? element.durationMs;
        const width = Math.max(0, (nextAt - cut.atMs) * pxPerMs);
        return (
          <span
            key={`span-${cut.atMs}`}
            className="pointer-events-none absolute bottom-0.5 z-10 truncate px-1.5 text-2xs text-overlay-foreground/75"
            style={{ left: cut.atMs * pxPerMs, maxWidth: width }}
          >
            {layoutName(cut.layoutId)}
          </span>
        );
      })}
      {/* Keyed by index, not atMs: retiming changes atMs on every move, and a
          key change would remount the tick mid-drag and kill its pointer
          capture (stranding the open transaction). */}
      {element.angles.slice(1).map((cut, i) => (
        <span
          key={`tick-${i}`}
          title="Drag to retime the cut · ⌥-click to remove"
          className="absolute inset-y-0 z-30 w-[7px] -translate-x-1/2 cursor-col-resize"
          style={{ left: cut.atMs * pxPerMs }}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.altKey) {
              try {
                engine.dispatch({ type: "removeAngleCut", elementId: element.id, atMs: cut.atMs });
              } catch {
                // Cut vanished.
              }
              return;
            }
            dragRef.current = { fromMs: cut.atMs, startClientX: event.clientX };
            engine.beginTransaction();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            const toMs = Math.round(drag.fromMs + (event.clientX - drag.startClientX) / pxPerMs);
            try {
              engine.dispatch({
                type: "moveAngleCut",
                elementId: element.id,
                fromMs: drag.fromMs,
                toMs,
              });
              drag.fromMs = Math.max(1, toMs);
            } catch {
              // Clamped into a neighbor: keep the last good position.
            }
          }}
          onPointerUp={(event) => {
            if (!dragRef.current) return;
            dragRef.current = null;
            engine.endTransaction();
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        >
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-overlay-foreground/80" />
        </span>
      ))}
    </>
  );
}

// Memoized: a clip drag dispatches per frame and re-renders its lane; with
// structural sharing only the moved element changes identity, so sibling
// clips bail here. Subscriptions are narrow (own selection flag, own asset)
// for the same reason — never the whole project.
export const Clip = memo(function Clip({
  element,
  track,
  pxPerMs,
}: {
  element: TimelineElement;
  track: Track;
  pxPerMs: number;
}) {
  const engine = useEditor();
  const clipDrag = useClipDrag();
  const { timelineTool } = useEditorUI();
  const selected = useEditorState((s) => s.selection.elementIds.includes(element.id));
  const multiSelected = useEditorState((s) => s.selection.elementIds.length >= 2);
  const asset = useEditorState((s) =>
    "assetId" in element ? s.project.assets[element.assetId] : undefined,
  );
  const widthPx = Math.max(10, element.durationMs * pxPerMs);
  const heightPx = TRACK_HEIGHT - 8;
  const label = clipLabel(element, asset);

  // The press only picks the gesture (selection + move vs trim); the shared
  // controller owns it from here via window listeners, so the gesture
  // survives this clip remounting under another lane mid-drag.
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    const selectionIds = engine.selection.elementIds;
    // Linked partners (shared linkId, e.g. a video and its detached audio)
    // select, move, and trim as one; this clip first so it anchors gestures.
    const linkGroup = getLinkedElementIds(engine.project, element.id);
    const groupMembers = getGroupedElementIds(engine.project, element.id);
    const groupedIds = [
      ...new Set(groupMembers.flatMap((id) => getLinkedElementIds(engine.project, id))),
    ];
    if (event.shiftKey) {
      const others = selectionIds.filter((id) => !groupedIds.includes(id));
      engine.select(selected ? others : [...others, ...groupedIds]);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    // Trim when the gesture is just this clip (plus linked partners, which
    // the drag controller trims in lockstep). The active tool decides what
    // the handles and the body do; the controller degrades unmet tool
    // gestures (no neighbor to roll/slide against, nothing to slip) back to
    // the plain trim/move.
    let mode: ClipDragMode = "move";
    const canTrim = canTrimFromTimeline(element);
    if (canTrim && timelineTool === "slip") mode = "slip";
    else if (canTrim && timelineTool === "slide") mode = "slide";
    else if (canTrim && offsetX <= TRIM_HANDLE_PX) {
      mode =
        timelineTool === "ripple" ? "ripple-start" : timelineTool === "roll" ? "roll-start" : "trim-start";
    } else if (canTrim && offsetX >= rect.width - TRIM_HANDLE_PX) {
      mode = timelineTool === "ripple" ? "ripple-end" : timelineTool === "roll" ? "roll-end" : "trim-end";
    }
    if (element.groupId) {
      if (mode === "roll-start" || mode === "ripple-start") mode = "trim-start";
      if (mode === "roll-end" || mode === "ripple-end") mode = "trim-end";
    }
    const clipOnlyMode = mode !== "move";
    const gestureSeedIds = clipOnlyMode ? linkGroup : groupedIds;
    const ids = selected && !clipOnlyMode && selectionIds.length > groupedIds.length
      ? [...groupedIds, ...selectionIds.filter((id) => !groupedIds.includes(id))]
      : [...gestureSeedIds];
    if (!selected) engine.select([...groupedIds]);

    clipDrag.begin(event, {
      mode,
      ids,
      ignoreIds: clipOnlyMode && element.groupId ? groupedIds : undefined,
      duplicateOnDrag: event.altKey && mode === "move",
    });
  };

  const playheadInside = () => {
    const t = engine.playback.state.currentTimeMs;
    return t > element.startMs && t < element.startMs + element.durationMs;
  };

  const isVisual =
    element.type === "video" || element.type === "image" || element.type === "text";
  const cutMs = element.startMs + element.durationMs;
  const nextAdjacent = track.elements.find((e) => e.startMs === cutMs && e.id !== element.id);
  const transition = "transition" in element ? element.transition : undefined;
  const speed = element.type === "video" || element.type === "audio" ? getAverageSpeed(element) : 1;
  const isReversed =
    (element.type === "video" || element.type === "audio") && element.reversed === true;
  const dispatchSafe = (command: Record<string, unknown> & { type: string }) => {
    try {
      engine.dispatch(command);
    } catch {
      // Rejected (overlap/bounds): timeline resyncs from state.
    }
  };
  const showTrimHandles = canTrimFromTimeline(element);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            data-mcut-clip={element.type}
            className={cn(
              // left-0 + translateX: moves stay off the layout path (left
              // would relayout every absolutely-positioned sibling per frame).
              "group absolute top-1 bottom-1 left-0 flex cursor-grab items-center overflow-hidden rounded-lg text-xs font-medium shadow-sm select-none active:cursor-grabbing",
              getElementUI(element.type).clipClassName,
              selected
                ? "ring-2 ring-overlay-foreground"
                : "ring-1 ring-overlay-foreground/10 hover:ring-overlay-foreground/30",
            )}
            style={{
              transform: `translateX(${element.startMs * pxPerMs}px)`,
              width: widthPx,
            }}
            onPointerDown={beginDrag}
            onContextMenu={() => {
              if (!selected) engine.select(getLinkedElementIds(engine.project, element.id));
            }}
            title={label}
          />
        }
      >
        {element.type === "video" && asset && (
          <>
            <VideoFilmstrip
              asset={asset}
              widthPx={widthPx}
              heightPx={heightPx}
              trimStartMs={element.trimStartMs}
              durationMs={element.durationMs}
              timeMap={element.timeMap}
              reversed={element.reversed}
              className="opacity-90"
            />
            <AudioWaveform
              asset={asset}
              widthPx={widthPx}
              heightPx={Math.round(heightPx * 0.35)}
              trimStartMs={element.trimStartMs}
              durationMs={element.durationMs}
              timeMap={element.timeMap}
              reversed={element.reversed}
              variant="strip"
              color="rgba(255, 255, 255, 0.65)"
            />
          </>
        )}
        {element.type === "audio" && asset && (
          <AudioWaveform
            asset={asset}
            widthPx={widthPx}
            heightPx={heightPx}
            trimStartMs={element.trimStartMs}
            durationMs={element.durationMs}
            timeMap={element.timeMap}
            reversed={element.reversed}
            color="rgba(167, 243, 208, 0.9)"
          />
        )}
        {element.type === "audio" && (
          <VolumeBand
            element={element}
            widthPx={widthPx}
            heightPx={heightPx + 8}
            interactive={selected}
          />
        )}
        {element.type === "multicam" && <MulticamWaveform element={element} widthPx={widthPx} heightPx={heightPx} />}
        {element.type === "multicam" && <MulticamCutTicks element={element} pxPerMs={pxPerMs} />}
        {(element.type === "video" || element.type === "audio" || element.type === "multicam") && (
          <FadeOverlay element={element} pxPerMs={pxPerMs} widthPx={widthPx} interactive={selected} />
        )}
        {selected && <KeyframeMarkers element={element} pxPerMs={pxPerMs} />}
        {(speed !== 1 || isReversed) && (
          <span className="pointer-events-none absolute top-0.5 right-2.5 z-10 rounded-sm bg-overlay/60 px-1 font-mono text-2xs text-overlay-foreground/90">
            {[speed !== 1 ? `${Number(speed.toFixed(2))}x` : null, isReversed ? "◀" : null]
              .filter(Boolean)
              .join(" ")}
          </span>
        )}
        {element.linkId && (
          <span
            title="Linked: selects and edits with its partner clip"
            className="pointer-events-none absolute top-0.5 left-2.5 z-10 rounded-sm bg-overlay/60 p-0.5 text-overlay-foreground/90"
          >
            <LinkIcon className="size-2.5" />
          </span>
        )}
        {transition && (
          <span
            title={
              nextAdjacent
                ? `${transition.type} → next clip`
                : "Transition inactive (next clip not flush)"
            }
            className={cn(
              "absolute top-1/2 right-[3px] z-30 size-2 -translate-y-1/2 rotate-45 rounded-[2px]",
              nextAdjacent ? "bg-(--snap-guide) ring-1 ring-overlay/40" : "bg-overlay-foreground/30",
            )}
          />
        )}
        <span
          className={cn(
            "pointer-events-none relative z-10 truncate px-2",
            (element.type === "video" || element.type === "audio") &&
              "rounded-sm bg-overlay/55 py-0.5 text-2xs mx-1.5",
          )}
        >
          {label}
        </span>
        {showTrimHandles && (
          <>
            {/* Trim brackets */}
            <span
              className={cn(
                // w-[9px]: trim-handle hit target tuned to sit inside the clip's 10px end caps.
                "absolute inset-y-0 left-0 z-20 flex w-[9px] cursor-ew-resize items-center justify-center bg-overlay-foreground/0 transition-colors",
                selected ? "bg-overlay-foreground/90" : "group-hover:bg-overlay-foreground/40",
              )}
            >
              <span
                className={cn(
                  "h-3.5 w-0.5 rounded-full",
                  selected ? "bg-overlay/70" : "bg-overlay-foreground/70",
                )}
              />
            </span>
            <span
              className={cn(
                "absolute inset-y-0 right-0 z-20 flex w-[9px] cursor-ew-resize items-center justify-center bg-overlay-foreground/0 transition-colors",
                selected ? "bg-overlay-foreground/90" : "group-hover:bg-overlay-foreground/40",
              )}
            >
              <span
                className={cn(
                  "h-3.5 w-0.5 rounded-full",
                  selected ? "bg-overlay/70" : "bg-overlay-foreground/70",
                )}
              />
            </span>
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!playheadInside()}
          onClick={() => splitSelectionAtPlayhead(engine)}
        >
          Split at playhead
          <span className="ml-auto pl-4 font-mono text-2xs text-muted-foreground">S</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => duplicateElement(engine, element.id)}>
          Duplicate
        </ContextMenuItem>
        {(element.type === "video" || element.type === "audio") && (
          <ContextMenuItem
            onClick={() =>
              engine.dispatch({
                type: "updateElement",
                elementId: element.id,
                patch: { muted: !element.muted },
              })
            }
          >
            {element.muted ? "Unmute" : "Mute"}
          </ContextMenuItem>
        )}
        {element.type === "video" && (
          <ContextMenuItem
            disabled={element.muted}
            onClick={() => dispatchSafe({ type: "detachAudio", elementId: element.id })}
          >
            Detach audio
          </ContextMenuItem>
        )}
        {element.linkId && (
          <ContextMenuItem onClick={() => unlinkElements(engine, element.id)}>
            Unlink
          </ContextMenuItem>
        )}
        {(element.type === "video" || element.type === "audio") && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Speed</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {/* Signed percentages: negative plays the source backward. */}
              {[25, 50, 100, 150, 200, 400, -100].map((pct) => (
                <ContextMenuItem
                  key={pct}
                  onClick={() => {
                    try {
                      engine.transact(() => {
                        engine.dispatch({
                          type: "setElementSpeed",
                          elementId: element.id,
                          speed: Math.abs(pct) / 100,
                        });
                        if ((pct < 0) !== (element.reversed ?? false)) {
                          engine.dispatch({
                            type: "updateElement",
                            elementId: element.id,
                            patch: { reversed: pct < 0 || undefined },
                          });
                        }
                      });
                    } catch {
                      // Rejected (overlap after rescale): timeline resyncs.
                    }
                  }}
                >
                  {pct}%{pct === -100 && " (reverse)"}
                  {Math.abs(speed * (element.reversed ? -100 : 100) - pct) < 0.5 && (
                    <span className="ml-auto pl-4 text-2xs text-muted-foreground">✓</span>
                  )}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {element.type === "multicam" && (
          <ContextMenuItem
            onClick={() => dispatchSafe({ type: "flattenMulticam", elementId: element.id })}
          >
            Flatten multicam
          </ContextMenuItem>
        )}
        {element.type === "video" && multiSelected && (
          <ContextMenuItem
            onClick={() => {
              const videoIds = engine.selection.elementIds.filter((id) =>
                engine.project.tracks.some((t) =>
                  t.elements.some((e) => e.id === id && e.type === "video"),
                ),
              );
              dispatchSafe({ type: "createMulticam", elementIds: videoIds });
            }}
          >
            Create multicam from selection
          </ContextMenuItem>
        )}
        {isVisual &&
          (transition ? (
            <ContextMenuItem
              onClick={() =>
                dispatchSafe({ type: "setTransition", elementId: element.id, transition: null })
              }
            >
              Remove transition
            </ContextMenuItem>
          ) : nextAdjacent ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>Transition into next</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {listTransitionTypes().map((type) => (
                  <ContextMenuItem
                    key={type}
                    className="capitalize"
                    onClick={() =>
                      dispatchSafe({
                        type: "setTransition",
                        elementId: element.id,
                        transition: { type, durationMs: 500 },
                      })
                    }
                  >
                    {type.replace("-", " ")}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null)}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => removeSelection(engine)}>
          Delete
          <span className="ml-auto pl-4 font-mono text-2xs text-muted-foreground">⌫</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
