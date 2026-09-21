'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useEditor, useEditorState, useMediaQuery, type PreviewQuality } from '@mcut/react'
import type { AnimatableProperty, ElementId } from '@mcut/timeline'
import { parseEditorPrefs, type EditorPrefs } from './editor-prefs'
import { clamp } from './math'

export interface DropPreview {
  trackId: string
  startMs: number
  durationMs: number
  label: string
}

interface OverlayStore<T> {
  get: () => T
  set: (value: T) => void
  subscribe: (listener: () => void) => () => void
}

function createOverlayStore<T>(initial: T, equals: (a: T, b: T) => boolean): OverlayStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: T) => {
      if (equals(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function dropPreviewEquals(a: DropPreview | null, b: DropPreview | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.trackId === b.trackId && a.startMs === b.startMs && a.durationMs === b.durationMs && a.label === b.label
}

interface DragOverlayStores {
  dropPreview: OverlayStore<DropPreview | null>
  snapGuide: OverlayStore<number | null>
}

const DragOverlayContext = createContext<DragOverlayStores | null>(null)

function useDragOverlayStores(): DragOverlayStores {
  const stores = useContext(DragOverlayContext)
  if (!stores) throw new Error('drag overlay hooks must be used inside <EditorUIProvider>')
  return stores
}

export function useDropPreview(): DropPreview | null {
  const { dropPreview } = useDragOverlayStores()
  return useSyncExternalStore(dropPreview.subscribe, dropPreview.get, () => null)
}

export function useSnapGuideMs(): number | null {
  const { snapGuide } = useDragOverlayStores()
  return useSyncExternalStore(snapGuide.subscribe, snapGuide.get, () => null)
}

export function useRerenderOnProjectEdits(): void {
  useEditorState((s) => s.project)
}

export function useLiveActionEnabledStates(): void {
  useRerenderOnProjectEdits()
  useEditorState((s) => s.selection)
}

export type EditorTheme = 'dark' | 'light'

export type EditorMode = 'edit' | 'multicam' | 'collage'

export type TimelineTool = 'select' | 'ripple' | 'roll' | 'slip' | 'slide'

export type TimelineEditMode = 'normal' | 'overwrite' | 'insert'

export type LeftTab = 'media' | 'text' | 'animate' | 'captions' | 'transcript'

export type WorkspaceLayout = 'full' | 'compact'

export const COMPACT_LAYOUT_QUERY = '(max-width: 639px)'

export const WORKSPACE_LAYOUT: Record<WorkspaceLayout, { trimHandlePx: number; trimHandlesAlwaysVisible: boolean; timelineHeaderPx: number }> = {
  full: { trimHandlePx: 9, trimHandlesAlwaysVisible: false, timelineHeaderPx: 288 },
  compact: { trimHandlePx: 20, trimHandlesAlwaysVisible: true, timelineHeaderPx: 112 },
}

export interface CurveEditorTarget {
  elementId: ElementId
  property: AnimatableProperty
}

export interface EditorUIValue {
  layout: WorkspaceLayout
  timelineHeaderPx: number
  theme: EditorTheme
  setTheme: (value: EditorTheme) => void
  mode: EditorMode
  setMode: (value: EditorMode) => void
  editingLayoutId: string | null
  setEditingLayoutId: (value: string | null) => void
  editingSlotIndex: number | null
  setEditingSlotIndex: (value: number | null) => void
  editingTextId: string | null
  setEditingTextId: (value: string | null) => void
  pxPerMs: number
  setPxPerMs: (value: number) => void
  zoomBy: (factor: number, anchorMs?: number) => void
  snapEnabled: boolean
  setSnapEnabled: (value: boolean) => void
  timelineTool: TimelineTool
  setTimelineTool: (value: TimelineTool) => void
  editMode: TimelineEditMode
  setEditMode: (value: TimelineEditMode) => void
  autoCrossfade: boolean
  setAutoCrossfade: (value: boolean) => void
  previewQuality: PreviewQuality
  setPreviewQuality: (value: PreviewQuality) => void
  leftTab: LeftTab
  setLeftTab: (value: LeftTab) => void
  revealLeftTab: (value: LeftTab) => void
  layoutResetToken: number
  resetLayout: () => void
  curveEditorTarget: CurveEditorTarget | null
  setCurveEditorTarget: (value: CurveEditorTarget | null) => void
  setDropPreview: (value: DropPreview | null) => void
  timelineScrollRef: React.RefObject<HTMLDivElement | null>
  setSnapGuideMs: (value: number | null) => void
}

export const MIN_PX_PER_MS = 0.004
export const MAX_PX_PER_MS = 0.6

const EditorUIContext = createContext<EditorUIValue | null>(null)

const PREFS_KEY = 'mcut:ui'

type ResolvedEditorPrefs = Required<EditorPrefs>

const DEFAULT_PREFS: ResolvedEditorPrefs = {
  pxPerMs: 0.05,
  snapEnabled: true,
  autoCrossfade: false,
  theme: 'dark',
  previewQuality: 'auto',
}

function loadPrefs(): EditorPrefs {
  if (typeof window === 'undefined') return {}
  try {
    return parseEditorPrefs(window.localStorage.getItem(PREFS_KEY))
  } catch {
    return {}
  }
}

let prefsSnapshot: ResolvedEditorPrefs | null = null
const prefsListeners = new Set<() => void>()

export function getEditorPrefs(): ResolvedEditorPrefs {
  if (prefsSnapshot) return prefsSnapshot
  const stored = loadPrefs()
  prefsSnapshot = {
    pxPerMs: stored.pxPerMs ? clampZoom(stored.pxPerMs) : DEFAULT_PREFS.pxPerMs,
    snapEnabled: stored.snapEnabled ?? DEFAULT_PREFS.snapEnabled,
    autoCrossfade: stored.autoCrossfade ?? DEFAULT_PREFS.autoCrossfade,
    theme: stored.theme ?? DEFAULT_PREFS.theme,
    previewQuality: stored.previewQuality ?? DEFAULT_PREFS.previewQuality,
  }
  return prefsSnapshot
}

function writePrefs(patch: Partial<ResolvedEditorPrefs>): void {
  prefsSnapshot = { ...getEditorPrefs(), ...patch }
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefsSnapshot))
  } catch {}
  for (const listener of prefsListeners) listener()
}

function subscribePrefs(listener: () => void): () => void {
  prefsListeners.add(listener)
  return () => prefsListeners.delete(listener)
}

function serverPrefs(): ResolvedEditorPrefs {
  return DEFAULT_PREFS
}

function useEditorPrefs(): ResolvedEditorPrefs {
  return useSyncExternalStore(subscribePrefs, getEditorPrefs, serverPrefs)
}

function setPxPerMs(value: number): void {
  writePrefs({ pxPerMs: clampZoom(value) })
}

function setTheme(value: EditorTheme): void {
  writePrefs({ theme: value })
}

function setSnapEnabled(value: boolean): void {
  writePrefs({ snapEnabled: value })
}

function setAutoCrossfade(value: boolean): void {
  writePrefs({ autoCrossfade: value })
}

function setPreviewQuality(value: PreviewQuality): void {
  writePrefs({ previewQuality: value })
}

export function EditorUIProvider({ children, leftPanelRef }: { children: ReactNode; leftPanelRef?: RefObject<{ expand: () => void } | null> }) {
  const engine = useEditor()
  const prefs = useEditorPrefs()
  const layout: WorkspaceLayout = useMediaQuery(COMPACT_LAYOUT_QUERY) ? 'compact' : 'full'
  const [timelineTool, setTimelineTool] = useState<TimelineTool>('select')
  const [editMode, setEditMode] = useState<TimelineEditMode>('normal')
  const [mode, setModeState] = useState<EditorMode>('edit')
  const [editingLayoutId, setEditingLayoutIdState] = useState<string | null>(null)
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null)
  const [editingTextId, setEditingTextIdState] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('media')
  const [layoutResetToken, setLayoutResetToken] = useState(0)
  const [curveEditorTarget, setCurveEditorTarget] = useState<CurveEditorTarget | null>(null)
  const setEditingLayoutId = useCallback(
    (value: string | null) => {
      setEditingLayoutIdState(value)
      const editingLayout = value ? engine.project.layouts.find((l) => l.id === value) : undefined
      setEditingSlotIndex(editingLayout ? editingLayout.slots.length - 1 : null)
    },
    [engine],
  )
  const setEditingTextId = useCallback(
    (value: string | null) => {
      if (value === editingTextId) return
      if (editingTextId !== null) engine.endTransaction()
      if (value !== null) engine.beginTransaction()
      setEditingTextIdState(value)
    },
    [editingTextId, engine],
  )
  const setMode = useCallback(
    (value: EditorMode) => {
      setModeState(value)
      setEditingLayoutIdState(null)
      setEditingSlotIndex(null)
      setEditingTextId(null)
    },
    [setEditingTextId],
  )
  const revealLeftTab = useCallback(
    (value: LeftTab) => {
      leftPanelRef?.current?.expand()
      setLeftTab(value)
    },
    [leftPanelRef],
  )
  const resetLayout = useCallback(() => setLayoutResetToken((value) => value + 1), [])
  const [overlayStores] = useState<DragOverlayStores>(() => ({
    dropPreview: createOverlayStore<DropPreview | null>(null, dropPreviewEquals),
    snapGuide: createOverlayStore<number | null>(null, Object.is),
  }))
  const setDropPreview = useCallback((value: DropPreview | null) => overlayStores.dropPreview.set(value), [overlayStores])
  const setSnapGuideMs = useCallback((value: number | null) => overlayStores.snapGuide.set(value), [overlayStores])
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)

  const zoomBy = useCallback((factor: number, anchorMs?: number) => {
    const previous = getEditorPrefs().pxPerMs
    const next = clampZoom(previous * factor)
    const scroller = timelineScrollRef.current
    if (scroller && anchorMs !== undefined) {
      const anchorX = anchorMs * previous - scroller.scrollLeft
      requestAnimationFrame(() => {
        scroller.scrollLeft = anchorMs * next - anchorX
      })
    }
    writePrefs({ pxPerMs: next })
  }, [])

  const value = useMemo<EditorUIValue>(
    () => ({
      layout,
      timelineHeaderPx: WORKSPACE_LAYOUT[layout].timelineHeaderPx,
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
      layout,
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
  )

  return (
    <EditorUIContext.Provider value={value}>
      <DragOverlayContext.Provider value={overlayStores}>{children}</DragOverlayContext.Provider>
    </EditorUIContext.Provider>
  )
}

function clampZoom(value: number): number {
  return clamp(value, MIN_PX_PER_MS, MAX_PX_PER_MS)
}

export function useEditorUI(): EditorUIValue {
  const context = useContext(EditorUIContext)
  if (!context) throw new Error('useEditorUI must be used inside <EditorUIProvider>')
  return context
}
