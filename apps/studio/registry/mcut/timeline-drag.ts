'use client'

import { createContext, useContext } from 'react'
import { useDisposable, useEditor, useLatest } from '@mcut/react'
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
} from '@mcut/editor'
import { createTrackId, getElementLocation, MIN_ELEMENT_DURATION_MS, type ElementId, type Track } from '@mcut/timeline'
import { getEditorPrefs, useEditorUI } from './editor-ui'
import { collectSnapTargets, snapClip, snapTime, type SnapTarget } from './timeline-snap'

type Engine = ReturnType<typeof useEditor>

export type { ClipDragMode } from '@mcut/editor'

export const TRACK_HEIGHT = 56
export const RULER_HEIGHT = 28
export const NEW_TRACK_LANE_HEIGHT = 36
export const SNAP_PX = 8

const DRAG_THRESHOLD_PX = 4
const AUTO_SCROLL_EDGE_PX = 36
const AUTO_SCROLL_MAX_PX = 18

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
  startClientX: number
  startClientY: number
  startScrollLeft: number
  startScrollTop: number
  lastClientX: number
  lastClientY: number
  lastAltKey: boolean
  active: boolean
  duplicateOnDrag: boolean
  duplicated: boolean
  createdTrackIds: Track['id'][]
  ignore: ReadonlySet<string>
  targets: SnapTarget[]
  appliedDeltaMs: number
  rollTargetId: ElementId | null
  slipRange: { minMs: number; maxMs: number } | null
}

function duplicateClipsToNewTracks(
  engine: Engine,
  ids: readonly ElementId[],
): { ids: ElementId[]; bases: Map<ElementId, ClipDragBase>; createdTrackIds: Track['id'][] } | null {
  const plan = planDuplicateClipsToNewTracks(engine.project, ids)
  if (!plan) return null
  for (const command of plan.commands) {
    engine.dispatch(command)
  }
  return {
    ids: plan.ids,
    bases: collectClipDragBases(engine.project, plan.ids),
    createdTrackIds: plan.createdTrackIds,
  }
}

function removeEmptyCreatedTracks(engine: Engine, trackIds: readonly Track['id'][]) {
  for (const trackId of trackIds) {
    const track = engine.project.tracks.find((t) => t.id === trackId)
    if (track && track.elements.length === 0) {
      engine.dispatch({ type: 'removeTrack', trackId })
    }
  }
}

function isDirectTrimMode(mode: ClipDragMode): boolean {
  return mode === 'trim-start' || mode === 'trim-end'
}

function slipDeltaOpposingThePointer(pointerDeltaMs: number): number {
  return -Math.round(pointerDeltaMs)
}

function edgeScrollSpeed(pos: number, min: number, max: number): number {
  if (pos < min + AUTO_SCROLL_EDGE_PX) {
    return -Math.min(AUTO_SCROLL_MAX_PX, ((min + AUTO_SCROLL_EDGE_PX - pos) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX)
  }
  if (pos > max - AUTO_SCROLL_EDGE_PX) {
    return Math.min(AUTO_SCROLL_MAX_PX, ((pos - (max - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX)
  }
  return 0
}

export class ClipDragController {
  constructor(private readonly deps: ClipDragDeps) {}

  private gesture: ClipDragGesture | null = null
  private autoScrollFrame: number | null = null
  private updateFrame: number | null = null
  private pendingMove = false
  private previousBodyUserSelect: string | null = null
  private capture: { element: Element; pointerId: number } | null = null

  begin(event: { clientX: number; clientY: number; pointerId: number }, options: ClipDragBeginOptions): void {
    this.cancel()
    const project = this.deps.engine.project
    const bases = collectClipDragBases(project, options.ids)
    if (options.ids.length === 0 || !bases.has(options.ids[0]!)) return
    const resolved = resolveToolMode(project, options.mode, options.ids)
    const scroller = this.deps.scrollerRef.current
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
      slipRange: resolved.mode === 'slip' ? computeSlipRange(project, options.ids) : null,
    }
    this.attach()
  }

  get dragging(): boolean {
    return this.gesture?.active ?? false
  }

  dispose(): void {
    this.cancel()
  }

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
      const threshold = bodyGesture ? DRAG_THRESHOLD_PX : 1
      if (travelled < threshold) return
      this.activate()
    }
    this.scheduleUpdate()
  }

  private scheduleUpdate(): void {
    if (this.updateFrame !== null) {
      this.pendingMove = true
      return
    }
    this.update()
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      if (this.pendingMove) {
        this.pendingMove = false
        this.update()
      }
    })
  }

  private onPointerUp = (event: PointerEvent) => {
    const gesture = this.gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    this.finish()
  }

  private onPointerCancel = (event: PointerEvent) => {
    const gesture = this.gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    this.cancel()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.gesture) return
    event.preventDefault()
    event.stopPropagation()
    this.cancel()
  }

  private onWindowBlur = () => {
    this.cancel()
  }

  private attach(): void {
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('blur', this.onWindowBlur)
  }

  private detach(): void {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('blur', this.onWindowBlur)
    if (this.capture !== null) {
      try {
        this.capture.element.releasePointerCapture(this.capture.pointerId)
      } catch {}
      this.capture = null
    }
    if (this.autoScrollFrame !== null) {
      cancelAnimationFrame(this.autoScrollFrame)
      this.autoScrollFrame = null
    }
    if (this.updateFrame !== null) {
      cancelAnimationFrame(this.updateFrame)
      this.updateFrame = null
    }
    this.pendingMove = false
    if (this.previousBodyUserSelect !== null) {
      document.body.style.userSelect = this.previousBodyUserSelect
      this.previousBodyUserSelect = null
    }
  }

  private activate(): void {
    const gesture = this.gesture!
    gesture.active = true
    this.deps.engine.beginTransaction()
    const captureElement = this.deps.scrollerRef.current ?? document.body
    try {
      captureElement.setPointerCapture(gesture.pointerId)
      this.capture = { element: captureElement, pointerId: gesture.pointerId }
    } catch {
      this.capture = null
    }
    this.previousBodyUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    if (gesture.duplicateOnDrag && !gesture.duplicated) {
      const duplicated = duplicateClipsToNewTracks(this.deps.engine, gesture.ids)
      if (duplicated) {
        gesture.ids = duplicated.ids
        gesture.bases = duplicated.bases
        gesture.createdTrackIds = duplicated.createdTrackIds
        gesture.duplicated = true
        this.deps.engine.select(duplicated.ids)
        gesture.ignore = new Set<string>(gesture.ids)
      }
    }
    gesture.targets = collectSnapTargets(this.deps.engine.project, this.deps.engine.playback.state.currentTimeMs, gesture.ignore)
    this.startAutoScroll()
  }

  private finish(): void {
    const gesture = this.gesture
    if (!gesture) return
    if (gesture.active && this.pendingMove) {
      this.pendingMove = false
      this.update()
    }
    this.gesture = null
    this.detach()
    if (gesture.active) {
      removeEmptyCreatedTracks(this.deps.engine, gesture.createdTrackIds)
      this.maybeAutoCrossfade(gesture)
      const shouldRetimeCollage = isDirectTrimMode(gesture.mode) && gesture.ids.some((id) => getElementLocation(this.deps.engine.project, id)?.element.groupId)
      if (shouldRetimeCollage) {
        try {
          retimeSequentialCollage(this.deps.engine)
        } catch {}
      }
      this.deps.engine.endTransaction()
      this.deps.setSnapGuideMs(null)
    }
  }

  private maybeAutoCrossfade(gesture: ClipDragGesture): void {
    const { engine } = this.deps
    const { pxPerMs, autoCrossfade } = this.deps.prefs()
    if (!autoCrossfade || gesture.mode !== 'move' || gesture.ids.length !== 1) return
    const anchorId = gesture.ids[0]!
    const base = gesture.bases.get(anchorId)
    if (!base) return
    const scroller = this.deps.scrollerRef.current
    const scrollDx = (scroller?.scrollLeft ?? gesture.startScrollLeft) - gesture.startScrollLeft
    const desiredStartMs = base.startMs + (gesture.lastClientX - gesture.startClientX + scrollDx) / pxPerMs
    const command = planAutoCrossfade(engine.project, { elementId: anchorId, desiredStartMs })
    if (command) {
      try {
        engine.dispatch(command)
      } catch {}
    }
  }

  private cancel(): void {
    const gesture = this.gesture
    if (!gesture) return
    this.gesture = null
    this.detach()
    if (gesture.active) {
      this.deps.engine.cancelTransaction()
      this.deps.setSnapGuideMs(null)
    }
  }

  private startAutoScroll(): void {
    if (this.autoScrollFrame !== null) return
    const tick = () => {
      const gesture = this.gesture
      const scroller = this.deps.scrollerRef.current
      if (!gesture?.active || !scroller) {
        this.autoScrollFrame = null
        return
      }
      const rect = scroller.getBoundingClientRect()
      const dx = edgeScrollSpeed(gesture.lastClientX, rect.left + this.deps.timelineHeaderPx(), rect.right)
      const dy = edgeScrollSpeed(gesture.lastClientY, rect.top + RULER_HEIGHT, rect.bottom)
      let scrolled = false
      if (dx !== 0) {
        const next = Math.max(0, Math.min(scroller.scrollLeft + dx, scroller.scrollWidth - scroller.clientWidth))
        if (next !== scroller.scrollLeft) {
          scroller.scrollLeft = next
          scrolled = true
        }
      }
      if (dy !== 0) {
        const next = Math.max(0, Math.min(scroller.scrollTop + dy, scroller.scrollHeight - scroller.clientHeight))
        if (next !== scroller.scrollTop) {
          scroller.scrollTop = next
          scrolled = true
        }
      }
      if (scrolled) this.update()
      this.autoScrollFrame = requestAnimationFrame(tick)
    }
    this.autoScrollFrame = requestAnimationFrame(tick)
  }

  private update(): void {
    const gesture = this.gesture
    if (!gesture?.active) return
    const { engine, setSnapGuideMs } = this.deps
    const { pxPerMs, snapEnabled } = this.deps.prefs()
    const scroller = this.deps.scrollerRef.current
    const scrollDx = (scroller?.scrollLeft ?? gesture.startScrollLeft) - gesture.startScrollLeft
    const deltaRawMs = (gesture.lastClientX - gesture.startClientX + scrollDx) / pxPerMs
    const liveProject = engine.project
    const anchorId = gesture.ids[0]!
    const anchorBase = gesture.bases.get(anchorId)!
    const { ignore, targets } = gesture
    const thresholdMs = SNAP_PX / pxPerMs

    try {
      if (gesture.mode === 'move') {
        const snapping = snapEnabled && !(gesture.lastAltKey && !gesture.duplicated)
        const snapped = snapClip(anchorBase.startMs + deltaRawMs, anchorBase.durationMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        })
        let guide = snapped.guideMs
        let deltaMs = Math.round(snapped.ms - anchorBase.startMs)
        const minStart = Math.min(...gesture.ids.map((id) => gesture.bases.get(id)!.startMs))
        deltaMs = Math.max(deltaMs, -minStart)

        if (gesture.ids.length === 1) {
          const trackCount = liveProject.tracks.length
          let targetIndex = anchorBase.trackIndex
          if (scroller) {
            const rect = scroller.getBoundingClientRect()
            const contentY = gesture.lastClientY - rect.top + scroller.scrollTop
            const visualRow = Math.floor((contentY - RULER_HEIGHT - NEW_TRACK_LANE_HEIGHT) / TRACK_HEIGHT)
            targetIndex = trackCount - 1 - visualRow
          }
          let targetTrack: Track | undefined
          if ((targetIndex >= trackCount || targetIndex < 0) && gesture.createdTrackIds.length === 0) {
            const trackId = createTrackId()
            engine.dispatch({
              type: 'addTrack',
              id: trackId,
              ...(targetIndex < 0 ? { index: 0 } : {}),
            })
            gesture.createdTrackIds.push(trackId)
            targetTrack = engine.project.tracks.find((track) => track.id === trackId)
          } else {
            targetIndex = Math.max(0, Math.min(targetIndex, trackCount - 1))
            targetTrack = liveProject.tracks[targetIndex]
          }
          if (!targetTrack) return
          if (targetTrack.locked) return
          let startMs = anchorBase.startMs + deltaMs
          if (targetTrack.magnetic) {
            startMs = Math.max(0, Math.round(anchorBase.startMs + deltaRawMs))
            guide = null
          } else if (!canPlaceIgnoring(targetTrack, startMs, anchorBase.durationMs, ignore)) {
            setSnapGuideMs(null)
            return
          }
          engine.dispatch({
            type: 'moveElement',
            elementId: anchorId,
            startMs,
            toTrackId: targetTrack.id,
          })
        } else {
          const placements = gesture.ids.map((id) => {
            const base = gesture.bases.get(id)!
            return {
              id,
              startMs: base.startMs + deltaMs,
              durationMs: base.durationMs,
              track: liveProject.tracks[base.trackIndex],
            }
          })
          const allFit = placements.every((p) => p.track && (p.track.magnetic || canPlaceIgnoring(p.track, p.startMs, p.durationMs, ignore)))
          if (allFit) {
            for (const p of placements) {
              engine.dispatch({ type: 'moveElement', elementId: p.id, startMs: p.startMs })
            }
          } else {
            guide = null
          }
        }
        setSnapGuideMs(guide)
        return
      }

      const snapping = snapEnabled && !gesture.lastAltKey

      if (gesture.mode === 'slip') {
        const range = gesture.slipRange ?? { minMs: -Infinity, maxMs: Infinity }
        const wanted = Math.max(range.minMs, Math.min(range.maxMs, slipDeltaOpposingThePointer(deltaRawMs)))
        const stepMs = wanted - gesture.appliedDeltaMs
        if (stepMs !== 0) {
          for (const id of gesture.ids) {
            const element = getElementLocation(liveProject, id)?.element
            if (!element) continue
            if (element.type !== 'video' && element.type !== 'audio' && element.type !== 'multicam') continue
            engine.dispatch({ type: 'slipElement', elementId: id, deltaMs: stepMs })
          }
          gesture.appliedDeltaMs = wanted
        }
        setSnapGuideMs(null)
        return
      }

      if (gesture.mode === 'slide') {
        const snapped = snapClip(anchorBase.startMs + deltaRawMs, anchorBase.durationMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        })
        const wanted = Math.round(snapped.ms) - anchorBase.startMs
        const stepMs = wanted - gesture.appliedDeltaMs
        if (stepMs !== 0) {
          engine.dispatch({ type: 'slideElement', elementId: anchorId, deltaMs: stepMs })
          gesture.appliedDeltaMs = wanted
        }
        setSnapGuideMs(gesture.appliedDeltaMs === wanted ? snapped.guideMs : null)
        return
      }

      if (gesture.mode === 'roll-start' || gesture.mode === 'roll-end') {
        const cutBaseMs = gesture.mode === 'roll-end' ? anchorBase.startMs + anchorBase.durationMs : anchorBase.startMs
        const snapped = snapTime(cutBaseMs + deltaRawMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        })
        const wanted = Math.round(snapped.ms) - cutBaseMs
        const rollId = gesture.mode === 'roll-end' ? anchorId : gesture.rollTargetId
        if (!rollId) return
        const stepMs = wanted - gesture.appliedDeltaMs
        if (stepMs !== 0) {
          engine.dispatch({ type: 'rollEdit', elementId: rollId, deltaMs: stepMs })
          gesture.appliedDeltaMs = wanted
        }
        setSnapGuideMs(gesture.appliedDeltaMs === wanted ? snapped.guideMs : null)
        return
      }

      if (gesture.mode === 'ripple-start' || gesture.mode === 'ripple-end') {
        const edge = gesture.mode === 'ripple-end' ? ('end' as const) : ('start' as const)
        const edgeBaseMs = edge === 'end' ? anchorBase.startMs + anchorBase.durationMs : anchorBase.startMs
        const rippleTargets = targets.filter((t) => t.kind === 'marker' || t.kind === 'playhead' || t.kind === 'origin')
        const snapped = snapTime(edgeBaseMs + deltaRawMs, rippleTargets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        })
        const wanted = Math.round(snapped.ms) - edgeBaseMs
        const stepMs = wanted - gesture.appliedDeltaMs
        if (stepMs !== 0) {
          engine.dispatch({ type: 'rippleTrim', elementId: anchorId, edge, deltaMs: stepMs })
          gesture.appliedDeltaMs = wanted
        }
        setSnapGuideMs(gesture.appliedDeltaMs === wanted ? snapped.guideMs : null)
        return
      }

      const members = gesture.ids.flatMap((id) => {
        const base = gesture.bases.get(id)
        if (!base) return []
        const element = getElementLocation(liveProject, id)?.element
        const asset = element && 'assetId' in element ? liveProject.assets[element.assetId] : undefined
        return [
          {
            id,
            base,
            element,
            assetDurationMs: asset?.durationMs,
            track: liveProject.tracks[base.trackIndex],
          },
        ]
      })
      const allFit = (startMs: (b: ClipDragBase) => number, durationMs: (b: ClipDragBase) => number) =>
        members.every(({ base, track }) => track && canPlaceIgnoring(track, startMs(base), durationMs(base), ignore))

      if (gesture.mode === 'trim-end') {
        const endSnap = snapTime(anchorBase.startMs + anchorBase.durationMs + deltaRawMs, targets, thresholdMs, {
          enabled: snapping,
          fps: liveProject.fps,
        })
        const wantedDelta = Math.round(endSnap.ms) - (anchorBase.startMs + anchorBase.durationMs)
        let deltaMs = wantedDelta
        for (const { base, assetDurationMs } of members) {
          if (!base.hasTimeMap && assetDurationMs !== undefined && base.trimStartMs !== undefined) {
            deltaMs = Math.min(deltaMs, base.reversed ? base.trimStartMs : assetDurationMs - base.trimStartMs - base.durationMs)
          }
          deltaMs = Math.max(deltaMs, MIN_ELEMENT_DURATION_MS - base.durationMs)
        }
        const fits = allFit(
          (b) => b.startMs,
          (b) => b.durationMs + deltaMs,
        )
        if (fits) {
          for (const { id, base, element } of members) {
            if (!element) continue
            const stepMs = base.startMs + base.durationMs + deltaMs - (element.startMs + element.durationMs)
            if (stepMs !== 0) {
              engine.dispatch({ type: 'trimEdge', elementId: id, edge: 'end', deltaMs: stepMs })
            }
          }
        }
        setSnapGuideMs(fits && deltaMs === wantedDelta ? endSnap.guideMs : null)
        return
      }

      const startSnap = snapTime(anchorBase.startMs + deltaRawMs, targets, thresholdMs, {
        enabled: snapping,
        fps: liveProject.fps,
      })
      const wantedShift = Math.round(startSnap.ms) - anchorBase.startMs
      let shift = wantedShift
      for (const { base, assetDurationMs } of members) {
        shift = Math.max(shift, -base.startMs)
        if (!base.hasTimeMap && base.trimStartMs !== undefined) {
          shift = Math.max(shift, base.reversed && assetDurationMs !== undefined ? -(assetDurationMs - base.trimStartMs - base.durationMs) : -base.trimStartMs)
        }
        if (base.hasTimeMap && base.reversed) shift = Math.max(shift, 0)
        shift = Math.min(shift, base.durationMs - MIN_ELEMENT_DURATION_MS)
      }
      const fits = allFit(
        (b) => b.startMs + shift,
        (b) => b.durationMs - shift,
      )
      if (fits) {
        for (const { id, base, element } of members) {
          if (!element) continue
          const stepMs = base.startMs + shift - element.startMs
          if (stepMs !== 0) {
            engine.dispatch({ type: 'trimEdge', elementId: id, edge: 'start', deltaMs: stepMs })
          }
        }
      }
      setSnapGuideMs(fits && shift === wantedShift ? startSnap.guideMs : null)
    } catch {}
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
