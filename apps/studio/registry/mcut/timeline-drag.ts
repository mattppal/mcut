'use client'

import { createContext, useContext } from 'react'
import { useDisposable, useEditor, useLatest } from '@mcut/react'
import {
  collectClipDragBases,
  computeSlipRange,
  planAutoCrossfade,
  planDuplicateClipsToNewTracks,
  retimeSequentialCollage,
  resolveToolMode,
  type ClipDragBase,
  type ClipDragMode,
} from '@mcut/editor'
import { createTrackId, getElementLocation, type ElementId, type Track, type TrackId } from '@mcut/timeline'
import { getEditorPrefs, useEditorUI } from './editor-ui'
import { removeEmptyCreatedTracks, rethrowUnlessRejected, stepLiveGesture } from './timeline-drag-live'
import { isPreviewMode, planClipDrag, type DragPlan } from './timeline-drag-plan'
import { EdgeAutoScroll } from './timeline-autoscroll'
import { ClipPreviewLayer, NEW_TRACK_LANE_HEIGHT, RULER_HEIGHT, TRACK_HEIGHT } from './timeline-drag-preview'
import { collectSnapTargets, type SnapTarget } from './timeline-snap'

type Engine = ReturnType<typeof useEditor>

export type { ClipDragMode } from '@mcut/editor'
export { NEW_TRACK_LANE_HEIGHT, RULER_HEIGHT, TRACK_HEIGHT } from './timeline-drag-preview'

const SNAP_PX = 8
const DRAG_THRESHOLD_PX = 4

export interface ClipDragBeginOptions {
  mode: ClipDragMode
  ids: ElementId[]
  ignoreIds?: ElementId[]
  duplicateOnDrag: boolean
}

export interface ClipDragPrefs {
  pxPerMs: number
  snapEnabled: boolean
  autoCrossfade: boolean
}

export interface ClipDragDeps {
  engine: Engine
  prefs: () => ClipDragPrefs
  timelineHeaderPx: () => number
  setSnapGuideMs: (ms: number | null) => void
  scrollerRef: React.RefObject<HTMLElement | null>
}

interface ClipDragGesture {
  mode: ClipDragMode
  pointerId: number
  ids: ElementId[]
  bases: Map<ElementId, ClipDragBase>
  anchor: ClipDragBase
  startClientX: number
  startClientY: number
  startScrollLeft: number
  lastClientX: number
  lastClientY: number
  lastAltKey: boolean
  active: boolean
  duplicateOnDrag: boolean
  duplicated: boolean
  createdTrackIds: Track['id'][]
  newTrackId: TrackId
  ignore: ReadonlySet<string>
  targets: SnapTarget[]
  appliedDeltaMs: number
  rollTargetId: ElementId | null
  slipRange: { minMs: number; maxMs: number } | null
  scrollerRect: DOMRect | null
  layer: ClipPreviewLayer | null
  plan: DragPlan | null
  lastValidPlan: DragPlan | null
}

export class ClipDragController {
  constructor(private readonly deps: ClipDragDeps) {}

  private gesture: ClipDragGesture | null = null
  private readonly autoScroll = new EdgeAutoScroll()
  private updateFrame: number | null = null
  private previousBodyUserSelect: string | null = null
  private capture: { element: Element; pointerId: number } | null = null

  begin(event: { clientX: number; clientY: number; pointerId: number }, options: ClipDragBeginOptions): void {
    this.cancel()
    const project = this.deps.engine.project
    const bases = collectClipDragBases(project, options.ids)
    const anchorId = options.ids[0]
    const anchor = anchorId === undefined ? undefined : bases.get(anchorId)
    if (!anchor) return
    const resolved = resolveToolMode(project, options.mode, options.ids)
    this.gesture = {
      mode: resolved.mode,
      pointerId: event.pointerId,
      ids: options.ids,
      bases,
      anchor,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: this.deps.scrollerRef.current?.scrollLeft ?? 0,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastAltKey: options.duplicateOnDrag,
      active: false,
      duplicateOnDrag: options.duplicateOnDrag,
      duplicated: false,
      createdTrackIds: [],
      newTrackId: createTrackId(),
      ignore: new Set<string>([...options.ids, ...(options.ignoreIds ?? [])]),
      targets: [],
      appliedDeltaMs: 0,
      rollTargetId: resolved.rollTargetId,
      slipRange: resolved.mode === 'slip' ? computeSlipRange(project, options.ids) : null,
      scrollerRect: null,
      layer: null,
      plan: null,
      lastValidPlan: null,
    }
    this.attach()
  }

  get dragging(): boolean {
    return this.gesture?.active ?? false
  }

  dispose = (): void => this.cancel()

  private onPointerMove = (event: PointerEvent) => {
    const gesture = this.gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if ((event.buttons & 1) === 0) {
      this.finish()
      return
    }
    gesture.lastClientX = event.clientX
    gesture.lastClientY = event.clientY
    gesture.lastAltKey = event.altKey
    if (!gesture.active) {
      const travelled = Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY)
      const bodyGesture = gesture.mode === 'move' || gesture.mode === 'slip' || gesture.mode === 'slide'
      if (travelled < (bodyGesture ? DRAG_THRESHOLD_PX : 1)) return
      this.activate(gesture)
    }
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      this.update()
    })
  }

  private onPointerUp = (event: PointerEvent) => {
    if (this.gesture?.pointerId === event.pointerId) this.finish()
  }

  private onPointerCancel = (event: PointerEvent) => {
    if (this.gesture?.pointerId === event.pointerId) this.cancel()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.gesture) return
    event.preventDefault()
    event.stopPropagation()
    this.cancel()
  }

  private onWindowBlur = () => this.cancel()

  private listening: AbortController | null = null

  private attach(): void {
    this.listening = new AbortController()
    const { signal } = this.listening
    window.addEventListener('pointermove', this.onPointerMove, { signal })
    window.addEventListener('pointerup', this.onPointerUp, { signal })
    window.addEventListener('pointercancel', this.onPointerCancel, { signal })
    window.addEventListener('blur', this.onWindowBlur, { signal })
    window.addEventListener('keydown', this.onKeyDown, { signal, capture: true })
  }

  private detach(): void {
    this.listening?.abort()
    this.listening = null
    if (this.capture !== null && this.capture.element.hasPointerCapture(this.capture.pointerId)) {
      this.capture.element.releasePointerCapture(this.capture.pointerId)
    }
    this.capture = null
    this.autoScroll.stop()
    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame)
      this.updateFrame = null
    }
    if (this.previousBodyUserSelect !== null) {
      document.body.style.userSelect = this.previousBodyUserSelect
      this.previousBodyUserSelect = null
    }
  }

  private activate(gesture: ClipDragGesture): void {
    const { engine, scrollerRef } = this.deps
    gesture.active = true
    engine.beginTransaction()
    const scroller = scrollerRef.current
    const captureElement = scroller ?? document.body
    try {
      captureElement.setPointerCapture(gesture.pointerId)
      this.capture = { element: captureElement, pointerId: gesture.pointerId }
    } catch (error) {
      if (!(error instanceof DOMException)) throw error
    }
    this.previousBodyUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    if (gesture.duplicateOnDrag && !gesture.duplicated) {
      const plan = planDuplicateClipsToNewTracks(engine.project, gesture.ids)
      if (plan) {
        for (const command of plan.commands) engine.dispatch(command)
        gesture.ids = plan.ids
        gesture.bases = collectClipDragBases(engine.project, plan.ids)
        gesture.anchor = gesture.bases.get(plan.ids[0] ?? '') ?? gesture.anchor
        gesture.createdTrackIds = plan.createdTrackIds
        gesture.duplicated = true
        engine.select(plan.ids)
        gesture.ignore = new Set<string>(gesture.ids)
      }
    }
    gesture.targets = collectSnapTargets(engine.project, engine.playback.state.currentTimeMs, gesture.ignore)
    gesture.scrollerRect = scroller?.getBoundingClientRect() ?? null
    gesture.layer = scroller && isPreviewMode(gesture.mode) ? new ClipPreviewLayer(scroller) : null
    this.startAutoScroll(gesture)
  }

  private flush(): void {
    if (this.updateFrame === null) return
    cancelAnimationFrame(this.updateFrame)
    this.updateFrame = null
    this.update()
  }

  private finish(): void {
    const gesture = this.gesture
    if (!gesture) return
    if (gesture.active) this.flush()
    this.gesture = null
    this.detach()
    if (!gesture.active) return
    const { engine, setSnapGuideMs } = this.deps
    setSnapGuideMs(null)
    const { pxPerMs, autoCrossfade } = this.deps.prefs()
    const pushedIntoNeighbour = autoCrossfade && gesture.mode === 'move' && gesture.ids.length === 1 && gesture.plan?.valid === false
    const plan = pushedIntoNeighbour ? gesture.lastValidPlan : gesture.plan
    if (isPreviewMode(gesture.mode)) {
      gesture.layer?.release(engine.project, pxPerMs)
      if (!plan || !this.commit(plan)) {
        engine.cancelTransaction()
        if (gesture.plan) gesture.layer?.settle(gesture.plan.previews, () => engine.project, pxPerMs, false)
        return
      }
    }
    removeEmptyCreatedTracks(engine, gesture.createdTrackIds)
    this.maybeAutoCrossfade(gesture)
    const touchesCollage =
      (gesture.mode === 'trim-start' || gesture.mode === 'trim-end') && gesture.ids.some((id) => getElementLocation(engine.project, id)?.element.groupId)
    if (touchesCollage) {
      try {
        retimeSequentialCollage(engine)
      } catch (error) {
        rethrowUnlessRejected(error)
      }
    }
    engine.endTransaction()
    if (gesture.plan) gesture.layer?.settle(gesture.plan.previews, () => engine.project, pxPerMs, true)
  }

  private commit(plan: DragPlan): boolean {
    if (!plan.valid) return false
    try {
      for (const command of plan.commands) this.deps.engine.dispatch(command)
      return true
    } catch (error) {
      rethrowUnlessRejected(error)
      return false
    }
  }

  private maybeAutoCrossfade(gesture: ClipDragGesture): void {
    const { engine } = this.deps
    const { pxPerMs, autoCrossfade } = this.deps.prefs()
    const anchorId = gesture.ids[0]
    if (!autoCrossfade || gesture.mode !== 'move' || gesture.ids.length !== 1 || anchorId === undefined) return
    const scrollDx = (this.deps.scrollerRef.current?.scrollLeft ?? gesture.startScrollLeft) - gesture.startScrollLeft
    const desiredStartMs = gesture.anchor.startMs + (gesture.lastClientX - gesture.startClientX + scrollDx) / pxPerMs
    const command = planAutoCrossfade(engine.project, { elementId: anchorId, desiredStartMs })
    if (!command) return
    try {
      engine.dispatch(command)
    } catch (error) {
      rethrowUnlessRejected(error)
    }
  }

  private cancel(): void {
    const gesture = this.gesture
    if (!gesture) return
    this.gesture = null
    this.detach()
    if (!gesture.active) return
    const { engine } = this.deps
    gesture.layer?.release(engine.project, this.deps.prefs().pxPerMs)
    engine.cancelTransaction()
    this.deps.setSnapGuideMs(null)
    if (gesture.plan) gesture.layer?.settle(gesture.plan.previews, () => engine.project, this.deps.prefs().pxPerMs, false)
  }

  private startAutoScroll(gesture: ClipDragGesture): void {
    const scroller = this.deps.scrollerRef.current
    const rect = gesture.scrollerRect
    if (!scroller || !rect) return
    this.autoScroll.start({
      scroller,
      bounds: { left: rect.left + this.deps.timelineHeaderPx(), right: rect.right, top: rect.top + RULER_HEIGHT, bottom: rect.bottom },
      pointer: () => (this.gesture === gesture && gesture.active ? { x: gesture.lastClientX, y: gesture.lastClientY } : null),
      axes: { x: true, y: true },
      onScroll: () => this.update(),
    })
  }

  private update(): void {
    const gesture = this.gesture
    if (!gesture?.active) return
    const { engine, setSnapGuideMs } = this.deps
    const { pxPerMs, snapEnabled } = this.deps.prefs()
    const scroller = this.deps.scrollerRef.current
    const scrollDx = (scroller?.scrollLeft ?? gesture.startScrollLeft) - gesture.startScrollLeft
    const deltaRawMs = (gesture.lastClientX - gesture.startClientX + scrollDx) / pxPerMs
    const thresholdMs = SNAP_PX / pxPerMs
    const snapping = snapEnabled && !(gesture.lastAltKey && !gesture.duplicated)

    if (isPreviewMode(gesture.mode)) {
      const rect = gesture.scrollerRect
      const pointerRow =
        scroller && rect ? Math.floor((gesture.lastClientY - rect.top + scroller.scrollTop - RULER_HEIGHT - NEW_TRACK_LANE_HEIGHT) / TRACK_HEIGHT) : null
      const plan = planClipDrag({
        project: engine.project,
        mode: gesture.mode,
        ids: gesture.ids,
        bases: gesture.bases,
        ignore: gesture.ignore,
        targets: gesture.targets,
        deltaRawMs,
        snapping,
        thresholdMs,
        pointerRow,
        newTrackId: gesture.createdTrackIds.length === 0 ? gesture.newTrackId : null,
      })
      gesture.plan = plan
      if (plan.valid) gesture.lastValidPlan = plan
      gesture.layer?.render(plan, gesture.bases, engine.project, pxPerMs)
      setSnapGuideMs(plan.guideMs)
      return
    }

    try {
      setSnapGuideMs(stepLiveGesture(engine, gesture.mode, gesture, { deltaRawMs, snapping, thresholdMs }))
    } catch (error) {
      rethrowUnlessRejected(error)
    }
  }
}

const ClipDragContext = createContext<ClipDragController | null>(null)

export const ClipDragProvider = ClipDragContext.Provider

export function useClipDragController(): ClipDragController {
  const engine = useEditor()
  const { setSnapGuideMs, timelineScrollRef, timelineHeaderPx } = useEditorUI()
  const latestHeaderPx = useLatest(timelineHeaderPx)
  return useDisposable(
    () =>
      new ClipDragController({
        engine,
        prefs: getEditorPrefs,
        timelineHeaderPx: () => latestHeaderPx.current,
        setSnapGuideMs,
        scrollerRef: timelineScrollRef,
      }),
  )
}

export function useClipDrag(): ClipDragController {
  const controller = useContext(ClipDragContext)
  if (!controller) throw new Error('useClipDrag must be used inside <ClipDragProvider>')
  return controller
}
