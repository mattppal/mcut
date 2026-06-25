"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useEditor } from "@mcut/react";
import {
  canPlaceIgnoring,
  collectClipDragBases,
  computeSlipRange,
  planAutoCrossfade,
  planDuplicateClipsToNewTracks,
  retimeSequentialCollage,
  resolveToolMode,
  type ClipDragBase,
  type ClipDragMode,
} from "@mcut/editor";
import {
  createTrackId,
  getElementLocation,
  MIN_ELEMENT_DURATION_MS,
  type ElementId,
  type Track,
} from "@mcut/timeline";
import { TIMELINE_HEADER_WIDTH, useEditorUI } from "./editor-ui";
import { collectSnapTargets, snapClip, snapTime, type SnapTarget } from "./timeline-snap";

type Engine = ReturnType<typeof useEditor>;

export type { ClipDragMode } from "@mcut/editor";

// Timeline geometry shared between the panel (layout) and the drag
// controller (row math, auto-scroll edges).
export const TRACK_HEIGHT = 56;
export const RULER_HEIGHT = 28;
/** Height of the always-mounted "new track" drop lane above the rows. */
export const NEW_TRACK_LANE_HEIGHT = 36;
export const SNAP_PX = 8;

/** Pointer travel before a press becomes a drag (vs a click/select). */
const DRAG_THRESHOLD_PX = 4;
/** Width of the auto-scroll zones at the scroller edges. */
const AUTO_SCROLL_EDGE_PX = 36;
/** Auto-scroll speed cap, px per frame. */
const AUTO_SCROLL_MAX_PX = 18;

export interface ClipDragBeginOptions {
  mode: ClipDragMode;
  /** Every element in the gesture, anchor (grabbed clip) first. */
  ids: ElementId[];
  /** Stationary elements to exclude from snapping/collision for this gesture. */
  ignoreIds?: ElementId[];
  /** ⌥-drag: copy the clips onto new tracks and move the copies. */
  duplicateOnDrag: boolean;
}

export interface ClipDragDeps {
  engine: Engine;
  pxPerMs: number;
  snapEnabled: boolean;
  /** Drop a dissolve when a move shoves a clip flush against a neighbor. */
  autoCrossfade: boolean;
  setSnapGuideMs: (ms: number | null) => void;
  scrollerRef: React.RefObject<HTMLElement | null>;
}

interface ClipDragGesture {
  mode: ClipDragMode;
  pointerId: number;
  ids: ElementId[];
  bases: Map<ElementId, ClipDragBase>;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  lastClientX: number;
  lastClientY: number;
  lastAltKey: boolean;
  /** Pointer travelled past the threshold; a transaction is open. */
  active: boolean;
  duplicateOnDrag: boolean;
  duplicated: boolean;
  createdTrackIds: Track["id"][];
  /** The dragged element ids (excluded from snapping/collision). */
  ignore: ReadonlySet<string>;
  /** Snap targets, collected once at activation — only the gesture's own clips move. */
  targets: SnapTarget[];
  /** Delta already dispatched for delta-based modes (slip/slide/roll/ripple). */
  appliedDeltaMs: number;
  /** roll-start rolls the PREVIOUS clip's end cut; resolved at begin(). */
  rollTargetId: ElementId | null;
  /** Slip clamp across the gesture's members, computed at begin(). */
  slipRange: { minMs: number; maxMs: number } | null;
}

function duplicateClipsToNewTracks(
  engine: Engine,
  ids: readonly ElementId[],
): { ids: ElementId[]; bases: Map<ElementId, ClipDragBase>; createdTrackIds: Track["id"][] } | null {
  const plan = planDuplicateClipsToNewTracks(engine.project, ids);
  if (!plan) return null;
  for (const command of plan.commands) {
    engine.dispatch(command);
  }
  return {
    ids: plan.ids,
    bases: collectClipDragBases(engine.project, plan.ids),
    createdTrackIds: plan.createdTrackIds,
  };
}

function removeEmptyCreatedTracks(engine: Engine, trackIds: readonly Track["id"][]) {
  for (const trackId of trackIds) {
    const track = engine.project.tracks.find((t) => t.id === trackId);
    if (track && track.elements.length === 0) {
      engine.dispatch({ type: "removeTrack", trackId });
    }
  }
}

function isDirectTrimMode(mode: ClipDragMode): boolean {
  return mode === "trim-start" || mode === "trim-end";
}

/** Scroll velocity toward whichever edge zone `pos` is inside, else 0. */
function edgeScrollSpeed(pos: number, min: number, max: number): number {
  if (pos < min + AUTO_SCROLL_EDGE_PX) {
    return -Math.min(AUTO_SCROLL_MAX_PX, ((min + AUTO_SCROLL_EDGE_PX - pos) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX);
  }
  if (pos > max - AUTO_SCROLL_EDGE_PX) {
    return Math.min(AUTO_SCROLL_MAX_PX, ((pos - (max - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX);
  }
  return 0;
}

/**
 * One drag gesture controller per timeline, owning clip move/trim from
 * pointerdown to commit.
 *
 * The listeners live on `window` and all state lives here — never on the
 * clip's DOM node. A cross-track move remounts the clip under another lane,
 * which destroys its node and would silently kill a node-bound gesture
 * (and strand the open transaction). With the controller, the clip is just
 * the place the gesture starts.
 *
 * Gesture model (matching desktop NLEs):
 * - press is a click until the pointer travels {@link DRAG_THRESHOLD_PX};
 *   only then does a transaction open (one undo entry per gesture)
 * - live dispatch, coalesced to the frame rate: the project is the preview
 * - Escape/blur/pointercancel aborts and rolls back via cancelTransaction
 * - a release we never see (outside the window) commits at the last applied
 *   position: pointer capture on the scroller catches most of these, and a
 *   buttons check on pointermove ends anything that slips through
 * - pointer near the scroller edges auto-scrolls, and the scroll delta is
 *   folded into the time/row math so the clip tracks the pointer
 */
export class ClipDragController {
  /** Deps live behind a ref refreshed each render; always read at event time. */
  constructor(private readonly depsRef: { readonly current: ClipDragDeps | null }) {}

  private get deps(): ClipDragDeps {
    const deps = this.depsRef.current;
    if (!deps) throw new Error("ClipDragController used before its deps were attached");
    return deps;
  }

  private gesture: ClipDragGesture | null = null;
  private autoScrollFrame: number | null = null;
  private updateFrame: number | null = null;
  /** A move arrived while a frame was pending; run one trailing update. */
  private pendingMove = false;
  private previousBodyUserSelect: string | null = null;
  private capture: { element: Element; pointerId: number } | null = null;

  begin(
    event: { clientX: number; clientY: number; pointerId: number },
    options: ClipDragBeginOptions,
  ): void {
    this.cancel(); // a stray previous gesture must not leak its transaction
    const project = this.deps.engine.project;
    const bases = collectClipDragBases(project, options.ids);
    if (options.ids.length === 0 || !bases.has(options.ids[0]!)) return;
    // Tool gestures degrade to their plain counterparts when their structural
    // requirements (adjacent neighbors, slippable source) aren't met.
    const resolved = resolveToolMode(project, options.mode, options.ids);
    const scroller = this.deps.scrollerRef.current;
    this.gesture = {
      mode: resolved.mode,
      pointerId: event.pointerId,
      ids: options.ids,
      bases,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: scroller?.scrollLeft ?? 0,
      startScrollTop: scroller?.scrollTop ?? 0,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastAltKey: options.duplicateOnDrag,
      active: false,
      duplicateOnDrag: options.duplicateOnDrag,
      duplicated: false,
      createdTrackIds: [],
      ignore: new Set<string>([...options.ids, ...(options.ignoreIds ?? [])]),
      targets: [],
      appliedDeltaMs: 0,
      rollTargetId: resolved.rollTargetId,
      slipRange: resolved.mode === "slip" ? computeSlipRange(project, options.ids) : null,
    };
    this.attach();
  }

  /** True while a gesture is past the drag threshold. */
  get dragging(): boolean {
    return this.gesture?.active ?? false;
  }

  dispose(): void {
    this.cancel();
  }

  // -- listeners --------------------------------------------------------------

  private onPointerMove = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if ((event.buttons & 1) === 0) {
      // The press was released where no pointerup reached us (outside the
      // window, capture lost): commit at the last applied position instead
      // of letting the clip chase a button-up pointer.
      this.finish();
      return;
    }
    gesture.lastClientX = event.clientX;
    gesture.lastClientY = event.clientY;
    gesture.lastAltKey = event.altKey;
    if (!gesture.active) {
      const travelled = Math.hypot(
        event.clientX - gesture.startClientX,
        event.clientY - gesture.startClientY,
      );
      // Body gestures (move/slip/slide) keep the click-vs-drag threshold;
      // edge gestures react immediately.
      const bodyGesture =
        gesture.mode === "move" || gesture.mode === "slip" || gesture.mode === "slide";
      const threshold = bodyGesture ? DRAG_THRESHOLD_PX : 1;
      if (travelled < threshold) return;
      this.activate();
    }
    this.scheduleUpdate();
  };

  /**
   * Coalesce moves to the frame rate (pointermove fires at 120Hz+ on
   * ProMotion): the first move of a burst applies immediately, the rest fold
   * into one trailing update on the next frame.
   */
  private scheduleUpdate(): void {
    if (this.updateFrame !== null) {
      this.pendingMove = true;
      return;
    }
    this.update();
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null;
      if (this.pendingMove) {
        this.pendingMove = false;
        this.update();
      }
    });
  }

  private onPointerUp = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.finish();
  };

  private onPointerCancel = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.cancel();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.gesture) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };

  private onWindowBlur = () => {
    this.cancel();
  };

  private attach(): void {
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("blur", this.onWindowBlur);
  }

  private detach(): void {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("blur", this.onWindowBlur);
    if (this.capture !== null) {
      try {
        this.capture.element.releasePointerCapture(this.capture.pointerId);
      } catch {
        // Pointer already released the capture itself.
      }
      this.capture = null;
    }
    if (this.autoScrollFrame !== null) {
      cancelAnimationFrame(this.autoScrollFrame);
      this.autoScrollFrame = null;
    }
    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame);
      this.updateFrame = null;
    }
    this.pendingMove = false;
    if (this.previousBodyUserSelect !== null) {
      document.body.style.userSelect = this.previousBodyUserSelect;
      this.previousBodyUserSelect = null;
    }
  }

  // -- gesture lifecycle ------------------------------------------------------

  private activate(): void {
    const gesture = this.gesture!;
    gesture.active = true;
    this.deps.engine.beginTransaction();
    // Capture on a stable node (never the clip, which remounts mid-drag) so
    // pointerup still reaches us when the button is released outside the
    // window. Also overrides touch's implicit capture on the clip node.
    const captureElement = this.deps.scrollerRef.current ?? document.body;
    try {
      captureElement.setPointerCapture(gesture.pointerId);
      this.capture = { element: captureElement, pointerId: gesture.pointerId };
    } catch {
      this.capture = null; // pointer already gone; the buttons guard covers us
    }
    this.previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    if (gesture.duplicateOnDrag && !gesture.duplicated) {
      const duplicated = duplicateClipsToNewTracks(this.deps.engine, gesture.ids);
      if (duplicated) {
        gesture.ids = duplicated.ids;
        gesture.bases = duplicated.bases;
        gesture.createdTrackIds = duplicated.createdTrackIds;
        gesture.duplicated = true;
        this.deps.engine.select(duplicated.ids);
        gesture.ignore = new Set<string>(gesture.ids);
      }
    }
    // Everything else stands still during the gesture, so snap targets are
    // collected once here instead of on every pointermove.
    gesture.targets = collectSnapTargets(
      this.deps.engine.project,
      this.deps.engine.playback.state.currentTimeMs,
      gesture.ignore,
    );
    this.startAutoScroll();
  }

  private finish(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.active && this.pendingMove) {
      // Apply the coalesced final move before committing the transaction.
      this.pendingMove = false;
      this.update();
    }
    this.gesture = null;
    this.detach();
    if (gesture.active) {
      removeEmptyCreatedTracks(this.deps.engine, gesture.createdTrackIds);
      this.maybeAutoCrossfade(gesture);
      const shouldRetimeCollage =
        isDirectTrimMode(gesture.mode) &&
        gesture.ids.some((id) => getElementLocation(this.deps.engine.project, id)?.element.groupId);
      if (shouldRetimeCollage) {
        try {
          retimeSequentialCollage(this.deps.engine);
        } catch {
          // Keep the user's trim if a partial collage cannot be inferred.
        }
      }
      this.deps.engine.endTransaction();
      this.deps.setSnapGuideMs(null);
    }
  }

  /**
   * GES-inspired overlap-implies-crossfade, adapted to the no-overlap model:
   * when a move commits flush against a neighbor AND the pointer actually
   * wanted to overlap it, drop a dissolve sized to the attempted overlap.
   * Opt-in (deps.autoCrossfade); part of the gesture's undo entry.
   */
  private maybeAutoCrossfade(gesture: ClipDragGesture): void {
    const { engine, pxPerMs, autoCrossfade } = this.deps;
    if (!autoCrossfade || gesture.mode !== "move" || gesture.ids.length !== 1) return;
    const anchorId = gesture.ids[0]!;
    const base = gesture.bases.get(anchorId);
    if (!base) return;
    const scroller = this.deps.scrollerRef.current;
    const scrollDx = (scroller?.scrollLeft ?? gesture.startScrollLeft) - gesture.startScrollLeft;
    const desiredStartMs =
      base.startMs + (gesture.lastClientX - gesture.startClientX + scrollDx) / pxPerMs;
    const command = planAutoCrossfade(engine.project, { elementId: anchorId, desiredStartMs });
    if (command) {
      try {
        engine.dispatch(command);
      } catch {
        // Audio-only pair or clips too short for a window: skip silently.
      }
    }
  }

  private cancel(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    this.detach();
    if (gesture.active) {
      // Rolls back everything since activate(), created tracks included.
      this.deps.engine.cancelTransaction();
      this.deps.setSnapGuideMs(null);
    }
  }

  // -- auto-scroll ------------------------------------------------------------

  private startAutoScroll(): void {
    if (this.autoScrollFrame !== null) return;
    const tick = () => {
      const gesture = this.gesture;
      const scroller = this.deps.scrollerRef.current;
      if (!gesture?.active || !scroller) {
        this.autoScrollFrame = null;
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const dx = edgeScrollSpeed(gesture.lastClientX, rect.left + TIMELINE_HEADER_WIDTH, rect.right);
      const dy = edgeScrollSpeed(gesture.lastClientY, rect.top + RULER_HEIGHT, rect.bottom);
      let scrolled = false;
      if (dx !== 0) {
        const next = Math.max(0, Math.min(scroller.scrollLeft + dx, scroller.scrollWidth - scroller.clientWidth));
        if (next !== scroller.scrollLeft) {
          scroller.scrollLeft = next;
          scrolled = true;
        }
      }
      if (dy !== 0) {
        const next = Math.max(0, Math.min(scroller.scrollTop + dy, scroller.scrollHeight - scroller.clientHeight));
        if (next !== scroller.scrollTop) {
          scroller.scrollTop = next;
          scrolled = true;
        }
      }
      if (scrolled) this.update();
      this.autoScrollFrame = requestAnimationFrame(tick);
    };
    this.autoScrollFrame = requestAnimationFrame(tick);
  }

  // -- move/trim resolution ----------------------------------------------------

  private update(): void {
    const gesture = this.gesture;
    if (!gesture?.active) return;
    const { engine, pxPerMs, snapEnabled, setSnapGuideMs } = this.deps;
    const scroller = this.deps.scrollerRef.current;
    // Fold scroll deltas in so auto-scroll (and mid-drag wheel) keeps the
    // clip under the pointer.
    const scrollDx = (scroller?.scrollLeft ?? gesture.startScrollLeft) - gesture.startScrollLeft;
    const deltaRawMs = (gesture.lastClientX - gesture.startClientX + scrollDx) / pxPerMs;
    const liveProject = engine.project;
    const anchorId = gesture.ids[0]!;
    const anchorBase = gesture.bases.get(anchorId)!;
    const { ignore, targets } = gesture;
    const thresholdMs = SNAP_PX / pxPerMs;

    try {
      if (gesture.mode === "move") {
        const snapping = snapEnabled && !(gesture.lastAltKey && !gesture.duplicated);
        const snapped = snapClip(anchorBase.startMs + deltaRawMs, anchorBase.durationMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        });
        let guide = snapped.guideMs;
        let deltaMs = Math.round(snapped.ms - anchorBase.startMs);
        const minStart = Math.min(...gesture.ids.map((id) => gesture.bases.get(id)!.startMs));
        deltaMs = Math.max(deltaMs, -minStart);

        if (gesture.ids.length === 1) {
          // Target the lane under the pointer (rows render reversed: the top
          // row is the last track). Outside the rows — above the top lane or
          // below the bottom one — the gesture grows a new track on that side.
          const trackCount = liveProject.tracks.length;
          let targetIndex = anchorBase.trackIndex;
          if (scroller) {
            const rect = scroller.getBoundingClientRect();
            const contentY = gesture.lastClientY - rect.top + scroller.scrollTop;
            const visualRow = Math.floor(
              (contentY - RULER_HEIGHT - NEW_TRACK_LANE_HEIGHT) / TRACK_HEIGHT,
            );
            targetIndex = trackCount - 1 - visualRow;
          }
          let targetTrack: Track | undefined;
          if (
            (targetIndex >= trackCount || targetIndex < 0) &&
            gesture.createdTrackIds.length === 0
          ) {
            const trackId = createTrackId();
            engine.dispatch({
              type: "addTrack",
              id: trackId,
              ...(targetIndex < 0 ? { index: 0 } : {}),
            });
            gesture.createdTrackIds.push(trackId);
            targetTrack = engine.project.tracks.find((track) => track.id === trackId);
          } else {
            targetIndex = Math.max(0, Math.min(targetIndex, trackCount - 1));
            targetTrack = liveProject.tracks[targetIndex];
          }
          if (!targetTrack) return;
          if (targetTrack.locked) return;
          let startMs = anchorBase.startMs + deltaMs;
          if (targetTrack.magnetic) {
            // Magnetic: the engine's slot rule places the clip; raw pointer
            // position chooses the slot and edge-snapping would fight it.
            startMs = Math.max(0, Math.round(anchorBase.startMs + deltaRawMs));
            guide = null;
          } else if (!canPlaceIgnoring(targetTrack, startMs, anchorBase.durationMs, ignore)) {
            // Blocked: hold the last valid placement instead of teleporting
            // to a free slot; the move resolves when the pointer reaches
            // free space (and the commit is always the last valid state).
            setSnapGuideMs(null);
            return;
          }
          engine.dispatch({
            type: "moveElement",
            elementId: anchorId,
            startMs,
            toTrackId: targetTrack.id,
          });
        } else {
          // Group move: time-shift only, all-or-nothing.
          const placements = gesture.ids.map((id) => {
            const base = gesture.bases.get(id)!;
            return {
              id,
              startMs: base.startMs + deltaMs,
              durationMs: base.durationMs,
              track: liveProject.tracks[base.trackIndex],
            };
          });
          const allFit = placements.every(
            (p) =>
              p.track &&
              (p.track.magnetic || canPlaceIgnoring(p.track, p.startMs, p.durationMs, ignore)),
          );
          if (allFit) {
            for (const p of placements) {
              engine.dispatch({ type: "moveElement", elementId: p.id, startMs: p.startMs });
            }
          } else {
            guide = null;
          }
        }
        setSnapGuideMs(guide);
        return;
      }

      const snapping = snapEnabled && !gesture.lastAltKey;

      if (gesture.mode === "slip") {
        // Dragging right slides the filmstrip right — earlier source at the
        // in point — so the trim delta is the pointer delta negated.
        const range = gesture.slipRange ?? { minMs: -Infinity, maxMs: Infinity };
        const wanted = Math.max(range.minMs, Math.min(range.maxMs, -Math.round(deltaRawMs)));
        const stepMs = wanted - gesture.appliedDeltaMs;
        if (stepMs !== 0) {
          for (const id of gesture.ids) {
            const element = getElementLocation(liveProject, id)?.element;
            if (!element) continue;
            if (element.type !== "video" && element.type !== "audio" && element.type !== "multicam") continue;
            engine.dispatch({ type: "slipElement", elementId: id, deltaMs: stepMs });
          }
          gesture.appliedDeltaMs = wanted;
        }
        setSnapGuideMs(null);
        return;
      }

      if (gesture.mode === "slide") {
        const snapped = snapClip(anchorBase.startMs + deltaRawMs, anchorBase.durationMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        });
        const wanted = Math.round(snapped.ms) - anchorBase.startMs;
        const stepMs = wanted - gesture.appliedDeltaMs;
        if (stepMs !== 0) {
          // Throws when a neighbor hits its minimum: applied stays, the clip
          // holds at the last valid spot.
          engine.dispatch({ type: "slideElement", elementId: anchorId, deltaMs: stepMs });
          gesture.appliedDeltaMs = wanted;
        }
        setSnapGuideMs(gesture.appliedDeltaMs === wanted ? snapped.guideMs : null);
        return;
      }

      if (gesture.mode === "roll-start" || gesture.mode === "roll-end") {
        const cutBaseMs =
          gesture.mode === "roll-end" ? anchorBase.startMs + anchorBase.durationMs : anchorBase.startMs;
        const snapped = snapTime(cutBaseMs + deltaRawMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        });
        const wanted = Math.round(snapped.ms) - cutBaseMs;
        const rollId = gesture.mode === "roll-end" ? anchorId : gesture.rollTargetId;
        if (!rollId) return;
        const stepMs = wanted - gesture.appliedDeltaMs;
        if (stepMs !== 0) {
          engine.dispatch({ type: "rollEdit", elementId: rollId, deltaMs: stepMs });
          gesture.appliedDeltaMs = wanted;
        }
        setSnapGuideMs(gesture.appliedDeltaMs === wanted ? snapped.guideMs : null);
        return;
      }

      if (gesture.mode === "ripple-start" || gesture.mode === "ripple-end") {
        const edge = gesture.mode === "ripple-end" ? ("end" as const) : ("start" as const);
        const edgeBaseMs =
          edge === "end" ? anchorBase.startMs + anchorBase.durationMs : anchorBase.startMs;
        // Downstream clips move with a ripple, so their edges are unreliable
        // magnets — snap only to the stationary kinds.
        const rippleTargets = targets.filter(
          (t) => t.kind === "marker" || t.kind === "playhead" || t.kind === "origin",
        );
        const snapped = snapTime(edgeBaseMs + deltaRawMs, rippleTargets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        });
        const wanted = Math.round(snapped.ms) - edgeBaseMs;
        const stepMs = wanted - gesture.appliedDeltaMs;
        if (stepMs !== 0) {
          engine.dispatch({ type: "rippleTrim", elementId: anchorId, edge, deltaMs: stepMs });
          gesture.appliedDeltaMs = wanted;
        }
        setSnapGuideMs(gesture.appliedDeltaMs === wanted ? snapped.guideMs : null);
        return;
      }

      // Trims cascade across the whole gesture (the grabbed clip plus its
      // linked partners): one shared delta, clamped so every member fits,
      // keeps linked video/audio edges in sync.
      const members = gesture.ids.flatMap((id) => {
        const base = gesture.bases.get(id);
        if (!base) return [];
        const element = getElementLocation(liveProject, id)?.element;
        const asset =
          element && "assetId" in element ? liveProject.assets[element.assetId] : undefined;
        return [
          {
            id,
            base,
            element,
            assetDurationMs: asset?.durationMs,
            track: liveProject.tracks[base.trackIndex],
          },
        ];
      });
      // All-or-nothing: a partner hitting a neighbor blocks the whole trim,
      // so linked edges never drift apart.
      const allFit = (startMs: (b: ClipDragBase) => number, durationMs: (b: ClipDragBase) => number) =>
        members.every(
          ({ base, track }) => track && canPlaceIgnoring(track, startMs(base), durationMs(base), ignore),
        );

      if (gesture.mode === "trim-end") {
        const endSnap = snapTime(anchorBase.startMs + anchorBase.durationMs + deltaRawMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        });
        const wantedDelta = Math.round(endSnap.ms) - (anchorBase.startMs + anchorBase.durationMs);
        let deltaMs = wantedDelta;
        for (const { base, assetDurationMs } of members) {
          // Growing the end consumes later source (forward) or earlier
          // source (reversed); a timeMap freezes at its boundary instead.
          if (!base.hasTimeMap && assetDurationMs !== undefined && base.trimStartMs !== undefined) {
            deltaMs = Math.min(
              deltaMs,
              base.reversed
                ? base.trimStartMs
                : assetDurationMs - base.trimStartMs - base.durationMs,
            );
          }
          deltaMs = Math.max(deltaMs, MIN_ELEMENT_DURATION_MS - base.durationMs);
        }
        const fits = allFit((b) => b.startMs, (b) => b.durationMs + deltaMs);
        if (fits) {
          for (const { id, base, element } of members) {
            if (!element) continue;
            // trimEdge keeps content anchored (reversed/speed-aware); the
            // step is the remaining distance from the LIVE element state.
            const stepMs = base.startMs + base.durationMs + deltaMs - (element.startMs + element.durationMs);
            if (stepMs !== 0) {
              engine.dispatch({ type: "trimEdge", elementId: id, edge: "end", deltaMs: stepMs });
            }
          }
        }
        setSnapGuideMs(fits && deltaMs === wantedDelta ? endSnap.guideMs : null);
        return;
      }

      // trim-start
      const startSnap = snapTime(anchorBase.startMs + deltaRawMs, targets, thresholdMs, {
        enabled: snapping,
        fps: liveProject.fps,
      });
      const wantedShift = Math.round(startSnap.ms) - anchorBase.startMs;
      let shift = wantedShift;
      for (const { base, assetDurationMs } of members) {
        shift = Math.max(shift, -base.startMs);
        // Growing the start reveals earlier source (forward) or later
        // source (reversed); reversed speed ramps can't grow their head.
        if (!base.hasTimeMap && base.trimStartMs !== undefined) {
          shift = Math.max(
            shift,
            base.reversed && assetDurationMs !== undefined
              ? -(assetDurationMs - base.trimStartMs - base.durationMs)
              : -base.trimStartMs,
          );
        }
        if (base.hasTimeMap && base.reversed) shift = Math.max(shift, 0);
        shift = Math.min(shift, base.durationMs - MIN_ELEMENT_DURATION_MS);
      }
      const fits = allFit((b) => b.startMs + shift, (b) => b.durationMs - shift);
      if (fits) {
        for (const { id, base, element } of members) {
          if (!element) continue;
          const stepMs = base.startMs + shift - element.startMs;
          if (stepMs !== 0) {
            engine.dispatch({ type: "trimEdge", elementId: id, edge: "start", deltaMs: stepMs });
          }
        }
      }
      setSnapGuideMs(fits && shift === wantedShift ? startSnap.guideMs : null);
    } catch {
      // Engine rejected (overlap/bounds): keep last valid state.
    }
  }
}

// ---------------------------------------------------------------------------
// React wiring
// ---------------------------------------------------------------------------

const ClipDragContext = createContext<ClipDragController | null>(null);

export const ClipDragProvider = ClipDragContext.Provider;

/**
 * Create the timeline's drag controller. Call once in the timeline panel and
 * hand the result to {@link ClipDragProvider}; clips reach it via
 * {@link useClipDrag}. Deps are refreshed every render so zoom/snap changes
 * mid-drag are picked up live.
 */
export function useClipDragController(): ClipDragController {
  const engine = useEditor();
  const { pxPerMs, snapEnabled, autoCrossfade, setSnapGuideMs, timelineScrollRef } = useEditorUI();
  const depsRef = useRef<ClipDragDeps | null>(null);
  const [controller] = useState(() => new ClipDragController(depsRef));
  useEffect(() => {
    depsRef.current = {
      engine,
      pxPerMs,
      snapEnabled,
      autoCrossfade,
      setSnapGuideMs,
      scrollerRef: timelineScrollRef,
    };
  });
  useEffect(() => () => controller.dispose(), [controller]);
  return controller;
}

/** The timeline's shared drag controller (begin a gesture from pointerdown). */
export function useClipDrag(): ClipDragController {
  const controller = useContext(ClipDragContext);
  if (!controller) throw new Error("useClipDrag must be used inside <ClipDragProvider>");
  return controller;
}
