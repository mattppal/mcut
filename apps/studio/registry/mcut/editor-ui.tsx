"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { PreviewQuality } from "@mcut/react";
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

export function EditorUIProvider({ children }: { children: ReactNode }) {
  const [pxPerMs, setPxPerMsState] = useState(0.05);
  const [snapEnabled, setSnapEnabledState] = useState(true);
  const [timelineTool, setTimelineTool] = useState<TimelineTool>("select");
  const [editMode, setEditMode] = useState<TimelineEditMode>("normal");
  const [autoCrossfade, setAutoCrossfadeState] = useState(false);
  const [previewQuality, setPreviewQualityState] = useState<PreviewQuality>("auto");
  const [theme, setThemeState] = useState<EditorTheme>("dark");
  const [mode, setModeState] = useState<EditorMode>("edit");
  const [editingLayoutId, setEditingLayoutIdState] = useState<string | null>(null);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const setEditingLayoutId = useCallback((value: string | null) => {
    setEditingLayoutIdState(value);
    setEditingSlotIndex(null); // slot selection is scoped to one layout
  }, []);
  const setMode = useCallback((value: EditorMode) => {
    setModeState(value);
    // Leaving a mode always exits slot editing.
    setEditingLayoutIdState(null);
    setEditingSlotIndex(null);
    setEditingTextId(null);
  }, []);
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

  useEffect(() => {
    // Apply persisted prefs after hydration (a lazy initializer would make
    // the server and client first paints disagree).
    const timer = setTimeout(() => {
      const prefs = loadPrefs();
      if (prefs.pxPerMs) setPxPerMsState(clampZoom(prefs.pxPerMs));
      if (prefs.snapEnabled !== undefined) setSnapEnabledState(prefs.snapEnabled);
      if (prefs.autoCrossfade !== undefined) setAutoCrossfadeState(prefs.autoCrossfade);
      if (isPreviewQuality(prefs.previewQuality)) setPreviewQualityState(prefs.previewQuality);
      if (prefs.theme === "light" || prefs.theme === "dark") setThemeState(prefs.theme);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const persist = (patch: Record<string, unknown>) => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
    } catch {
      // Private mode: prefs just don't persist.
    }
  };

  const setPxPerMs = useCallback((value: number) => {
    const clamped = clampZoom(value);
    setPxPerMsState(clamped);
    persist({ pxPerMs: clamped });
  }, []);

  const setTheme = useCallback((value: EditorTheme) => {
    setThemeState(value);
    persist({ theme: value });
  }, []);

  const setSnapEnabled = useCallback((value: boolean) => {
    setSnapEnabledState(value);
    persist({ snapEnabled: value });
  }, []);

  const setAutoCrossfade = useCallback((value: boolean) => {
    setAutoCrossfadeState(value);
    persist({ autoCrossfade: value });
  }, []);

  const setPreviewQuality = useCallback((value: PreviewQuality) => {
    setPreviewQualityState(value);
    persist({ previewQuality: value });
  }, []);

  const zoomBy = useCallback(
    (factor: number, anchorMs?: number) => {
      setPxPerMsState((previous) => {
        const next = clampZoom(previous * factor);
        const scroller = timelineScrollRef.current;
        if (scroller && anchorMs !== undefined) {
          // Keep anchorMs under the same screen x after the zoom.
          const anchorX = anchorMs * previous - scroller.scrollLeft;
          requestAnimationFrame(() => {
            scroller.scrollLeft = anchorMs * next - anchorX;
          });
        }
        persist({ pxPerMs: next });
        return next;
      });
    },
    [],
  );

  // Memoized so a provider re-render doesn't re-render every consumer; only
  // actual value changes do.
  const value = useMemo<EditorUIValue>(
    () => ({
      theme,
      setTheme,
      mode,
      setMode,
      editingLayoutId,
      setEditingLayoutId,
      editingSlotIndex,
      setEditingSlotIndex,
      editingTextId,
      setEditingTextId,
      pxPerMs,
      setPxPerMs,
      zoomBy,
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
      setDropPreview,
      timelineScrollRef,
      setSnapGuideMs,
    }),
    [
      theme,
      setTheme,
      mode,
      setMode,
      editingLayoutId,
      setEditingLayoutId,
      editingSlotIndex,
      editingTextId,
      pxPerMs,
      setPxPerMs,
      zoomBy,
      snapEnabled,
      setSnapEnabled,
      timelineTool,
      editMode,
      autoCrossfade,
      setAutoCrossfade,
      previewQuality,
      setPreviewQuality,
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
