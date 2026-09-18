"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { useEditor, type PreviewQuality } from "@mcut/react";
import type { AnimatableProperty, ElementId } from "@mcut/timeline";
import { clamp } from "./math";

/** A live drop ghost while dragging media over the timeline. */
export interface DropPreview {
  /** Target track id, or "new-track" for the phantom top lane. */
  trackId: string;
  startMs: number;
  durationMs: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Drag overlay stores
// ---------------------------------------------------------------------------
// Drop ghost and snap guide update on every pointermove during a drag. They
// live in tiny external stores (not React context state) so a drag move
// re-renders only the overlay components that subscribe via useDropPreview/
// useSnapGuideMs — never the whole editor tree.

interface OverlayStore<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

function createOverlayStore<T>(initial: T, equals: (a: T, b: T) => boolean): OverlayStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      if (equals(value, next)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function dropPreviewEquals(a: DropPreview | null, b: DropPreview | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.trackId === b.trackId &&
    a.startMs === b.startMs &&
    a.durationMs === b.durationMs &&
    a.label === b.label
  );
}

interface DragOverlayStores {
  dropPreview: OverlayStore<DropPreview | null>;
  snapGuide: OverlayStore<number | null>;
}

const DragOverlayContext = createContext<DragOverlayStores | null>(null);

function useDragOverlayStores(): DragOverlayStores {
  const stores = useContext(DragOverlayContext);
  if (!stores) throw new Error("drag overlay hooks must be used inside <EditorUIProvider>");
  return stores;
}

/** The live drop ghost, or null when no media drag is over the timeline. */
export function useDropPreview(): DropPreview | null {
  const { dropPreview } = useDragOverlayStores();
  return useSyncExternalStore(dropPreview.subscribe, dropPreview.get, () => null);
}

/** The snap guide line (timeline ms), or null when nothing is snapping. */
export function useSnapGuideMs(): number | null {
  const { snapGuide } = useDragOverlayStores();
  return useSyncExternalStore(snapGuide.subscribe, snapGuide.get, () => null);
}

export type EditorTheme = "dark" | "light";

/**
 * Editing modes are VIEWS, not document state: they re-emphasize affordances
 * (multicam = layout bank + 1–9 switching) over the same project.
 */
export type EditorMode = "edit" | "multicam" | "collage";

/**
 * Timeline pointer tools (Premiere's tool palette): select is the default
 * move/trim tool; ripple/roll change what the trim handles do; slip/slide
 * change what dragging the clip body does.
 */
export type TimelineTool = "select" | "ripple" | "roll" | "slip" | "slide";

/**
 * Placement mode for inserts and drops (Kdenlive's taxonomy): normal rejects
 * collisions, overwrite clears the landing range, insert ripples everything
 * after the point to the right.
 */
export type TimelineEditMode = "normal" | "overwrite" | "insert";

export type LeftTab = "media" | "text" | "animate" | "captions" | "transcript";

export interface CurveEditorTarget {
  elementId: ElementId;
  property: AnimatableProperty;
}

export interface EditorUIValue {
  /** Editor color theme (warm grey light/dark; tokens in globals.css). */
  theme: EditorTheme;
  setTheme: (value: EditorTheme) => void;
  /** Current editing mode (session-scoped; not persisted). */
  mode: EditorMode;
  setMode: (value: EditorMode) => void;
  /** Layout whose slots are being edited on the canvas (multicam mode). */
  editingLayoutId: string | null;
  setEditingLayoutId: (value: string | null) => void;
  /**
   * Slot edit state: index of the slot (within the editing layout) whose
   * properties the inspector shows. Shared so the canvas overlay and the
   * properties panel select and style the same slot.
   */
  editingSlotIndex: number | null;
  setEditingSlotIndex: (value: number | null) => void;
  /** Text element being edited INLINE on the canvas (double-click to enter). */
  editingTextId: string | null;
  setEditingTextId: (value: string | null) => void;
  /** Timeline zoom. */
  pxPerMs: number;
  setPxPerMs: (value: number) => void;
  /** Zoom keeping `anchorMs` under the same screen x (used by ⌘+wheel). */
  zoomBy: (factor: number, anchorMs?: number) => void;
  snapEnabled: boolean;
  setSnapEnabled: (value: boolean) => void;
  /** Active timeline pointer tool (session-scoped). */
  timelineTool: TimelineTool;
  setTimelineTool: (value: TimelineTool) => void;
  /** Placement mode for inserts/drops (session-scoped). */
  editMode: TimelineEditMode;
  setEditMode: (value: TimelineEditMode) => void;
  /** Drop a dissolve when a dragged clip is pushed flush against a neighbor. */
  autoCrossfade: boolean;
  setAutoCrossfade: (value: boolean) => void;
  /** Preview raster resolution ('auto' fits the pane; numbers cap the short side). */
  previewQuality: PreviewQuality;
  setPreviewQuality: (value: PreviewQuality) => void;
  leftTab: LeftTab;
  setLeftTab: (value: LeftTab) => void;
  revealLeftTab: (value: LeftTab) => void;
  layoutResetToken: number;
  resetLayout: () => void;
  curveEditorTarget: CurveEditorTarget | null;
  setCurveEditorTarget: (value: CurveEditorTarget | null) => void;
  /** Publish the drop ghost (read it via useDropPreview — it's not in this context). */
  setDropPreview: (value: DropPreview | null) => void;
  /** The timeline's horizontal scroll container (for zoom anchoring/auto-scroll). */
  timelineScrollRef: React.RefObject<HTMLDivElement | null>;
  /** Publish the snap guide line (read it via useSnapGuideMs). */
  setSnapGuideMs: (value: number | null) => void;
}

export const MIN_PX_PER_MS = 0.004;
export const MAX_PX_PER_MS = 0.6;
/** Left header gutter width inside the timeline, px. */
export const TIMELINE_HEADER_WIDTH = 288;

const EditorUIContext = createContext<EditorUIValue | null>(null);

const PREFS_KEY = "mcut:ui";

interface EditorPrefs {
  pxPerMs: number;
  snapEnabled: boolean;
  autoCrossfade: boolean;
  theme: EditorTheme;
  previewQuality: PreviewQuality;
}

const DEFAULT_PREFS: EditorPrefs = {
  pxPerMs: 0.05,
  snapEnabled: true,
  autoCrossfade: false,
  theme: "dark",
  previewQuality: "auto",
};

function loadPrefs(): {
  pxPerMs?: number;
  snapEnabled?: boolean;
  autoCrossfade?: boolean;
  theme?: EditorTheme;
  previewQuality?: PreviewQuality;
} {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function isPreviewQuality(value: unknown): value is PreviewQuality {
  return value === "auto" || value === "full" || (typeof value === "number" && value > 0);
}

let prefsSnapshot: EditorPrefs | null = null;
const prefsListeners = new Set<() => void>();

export function getEditorPrefs(): EditorPrefs {
  if (prefsSnapshot) return prefsSnapshot;
  const stored = loadPrefs();
  prefsSnapshot = {
    pxPerMs: stored.pxPerMs ? clampZoom(stored.pxPerMs) : DEFAULT_PREFS.pxPerMs,
    snapEnabled: stored.snapEnabled ?? DEFAULT_PREFS.snapEnabled,
    autoCrossfade: stored.autoCrossfade ?? DEFAULT_PREFS.autoCrossfade,
    theme: stored.theme === "light" || stored.theme === "dark" ? stored.theme : DEFAULT_PREFS.theme,
    previewQuality: isPreviewQuality(stored.previewQuality)
      ? stored.previewQuality
      : DEFAULT_PREFS.previewQuality,
  };
  return prefsSnapshot;
}

function writePrefs(patch: Partial<EditorPrefs>): void {
  prefsSnapshot = { ...getEditorPrefs(), ...patch };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefsSnapshot));
  } catch {}
  for (const listener of prefsListeners) listener();
}

function subscribePrefs(listener: () => void): () => void {
  prefsListeners.add(listener);
  return () => prefsListeners.delete(listener);
}

function serverPrefs(): EditorPrefs {
  return DEFAULT_PREFS;
}

function useEditorPrefs(): EditorPrefs {
  return useSyncExternalStore(subscribePrefs, getEditorPrefs, serverPrefs);
}

function setPxPerMs(value: number): void {
  writePrefs({ pxPerMs: clampZoom(value) });
}

function setTheme(value: EditorTheme): void {
  writePrefs({ theme: value });
}

function setSnapEnabled(value: boolean): void {
  writePrefs({ snapEnabled: value });
}

function setAutoCrossfade(value: boolean): void {
  writePrefs({ autoCrossfade: value });
}

function setPreviewQuality(value: PreviewQuality): void {
  writePrefs({ previewQuality: value });
}

export function EditorUIProvider({
  children,
  leftPanelRef,
}: {
  children: ReactNode;
  leftPanelRef?: RefObject<{ expand: () => void } | null>;
}) {
  const engine = useEditor();
  const prefs = useEditorPrefs();
  const [timelineTool, setTimelineTool] = useState<TimelineTool>("select");
  const [editMode, setEditMode] = useState<TimelineEditMode>("normal");
  const [mode, setModeState] = useState<EditorMode>("edit");
  const [editingLayoutId, setEditingLayoutIdState] = useState<string | null>(null);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [editingTextId, setEditingTextIdState] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("media");
  const [layoutResetToken, setLayoutResetToken] = useState(0);
  const [curveEditorTarget, setCurveEditorTarget] = useState<CurveEditorTarget | null>(null);
  const setEditingLayoutId = useCallback(
    (value: string | null) => {
      setEditingLayoutIdState(value);
      const layout = value ? engine.project.layouts.find((l) => l.id === value) : undefined;
      setEditingSlotIndex(layout ? layout.slots.length - 1 : null);
    },
    [engine],
  );
  const setEditingTextId = useCallback(
    (value: string | null) => {
      if (value === editingTextId) return;
      if (editingTextId !== null) engine.endTransaction();
      if (value !== null) engine.beginTransaction();
      setEditingTextIdState(value);
    },
    [editingTextId, engine],
  );
  const setMode = useCallback(
    (value: EditorMode) => {
      setModeState(value);
      setEditingLayoutIdState(null);
      setEditingSlotIndex(null);
      setEditingTextId(null);
    },
    [setEditingTextId],
  );
  const revealLeftTab = useCallback(
    (value: LeftTab) => {
      leftPanelRef?.current?.expand();
      setLeftTab(value);
    },
    [leftPanelRef],
  );
  const resetLayout = useCallback(() => setLayoutResetToken((value) => value + 1), []);
  const [overlayStores] = useState<DragOverlayStores>(() => ({
    dropPreview: createOverlayStore<DropPreview | null>(null, dropPreviewEquals),
    snapGuide: createOverlayStore<number | null>(null, Object.is),
  }));
  const setDropPreview = useCallback(
    (value: DropPreview | null) => overlayStores.dropPreview.set(value),
    [overlayStores],
  );
  const setSnapGuideMs = useCallback(
    (value: number | null) => overlayStores.snapGuide.set(value),
    [overlayStores],
  );
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  const zoomBy = useCallback((factor: number, anchorMs?: number) => {
    const previous = getEditorPrefs().pxPerMs;
    const next = clampZoom(previous * factor);
    const scroller = timelineScrollRef.current;
    if (scroller && anchorMs !== undefined) {
      const anchorX = anchorMs * previous - scroller.scrollLeft;
      requestAnimationFrame(() => {
        scroller.scrollLeft = anchorMs * next - anchorX;
      });
    }
    writePrefs({ pxPerMs: next });
  }, []);

  // Memoized so a provider re-render doesn't re-render every consumer; only
  // actual value changes do.
  const value = useMemo<EditorUIValue>(
    () => ({
      theme: prefs.theme,
      setTheme,
      mode,
      setMode,
      editingLayoutId,
      setEditingLayoutId,
      editingSlotIndex,
      setEditingSlotIndex,
      editingTextId,
      setEditingTextId,
      pxPerMs: prefs.pxPerMs,
      setPxPerMs,
      zoomBy,
      snapEnabled: prefs.snapEnabled,
      setSnapEnabled,
      timelineTool,
      setTimelineTool,
      editMode,
      setEditMode,
      autoCrossfade: prefs.autoCrossfade,
      setAutoCrossfade,
      previewQuality: prefs.previewQuality,
      setPreviewQuality,
      leftTab,
      setLeftTab,
      revealLeftTab,
      layoutResetToken,
      resetLayout,
      curveEditorTarget,
      setCurveEditorTarget,
      setDropPreview,
      timelineScrollRef,
      setSnapGuideMs,
    }),
    [
      prefs,
      mode,
      setMode,
      editingLayoutId,
      setEditingLayoutId,
      editingSlotIndex,
      editingTextId,
      setEditingTextId,
      zoomBy,
      timelineTool,
      editMode,
      leftTab,
      revealLeftTab,
      layoutResetToken,
      resetLayout,
      curveEditorTarget,
      setDropPreview,
      setSnapGuideMs,
    ],
  );

  return (
    <EditorUIContext.Provider value={value}>
      <DragOverlayContext.Provider value={overlayStores}>
        {children}
      </DragOverlayContext.Provider>
    </EditorUIContext.Provider>
  );
}

function clampZoom(value: number): number {
  return clamp(value, MIN_PX_PER_MS, MAX_PX_PER_MS);
}

export function useEditorUI(): EditorUIValue {
  const context = useContext(EditorUIContext);
  if (!context) throw new Error("useEditorUI must be used inside <EditorUIProvider>");
  return context;
}
