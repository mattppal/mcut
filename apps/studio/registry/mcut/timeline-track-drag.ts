'use client'

import { createContext, useContext } from 'react'
import { useDisposable, useEditor } from '@mcut/react'
import { type EditorEngine, type TrackId } from '@mcut/timeline'
import { useEditorUI } from './editor-ui'
import { EdgeAutoScroll } from './timeline-autoscroll'
import { rethrowUnlessRejected } from './timeline-drag-live'
import { glide, motionEase, ROW_SHIFT_MS, RULER_HEIGHT, TRACK_HEIGHT } from './timeline-drag-preview'

const DRAG_THRESHOLD_PX = 4
const SETTLE_MS = 180

interface TrackGesture {
  trackId: TrackId
  pointerId: number
  fromRow: number
  targetRow: number
  startClientY: number
  startScrollTop: number
  lastClientY: number
  active: boolean
  rows: HTMLElement[]
  capture: Element
}

function reorderCommand(engine: EditorEngine, trackId: TrackId, targetRow: number) {
  return { type: 'reorderTrack' as const, trackId, toIndex: engine.project.tracks.length - 1 - targetRow }
}

export class TrackDragController {
  private gesture: TrackGesture | null = null
  private frame: number | null = null
  private listening: AbortController | null = null
  private transitionReset: ReturnType<typeof setTimeout> | null = null
  private readonly autoScroll = new EdgeAutoScroll()

  constructor(
    private readonly engine: EditorEngine,
    private readonly scrollerRef: React.RefObject<HTMLElement | null>,
  ) {}

  begin(event: { clientY: number; pointerId: number; currentTarget: Element }, trackId: TrackId): void {
    this.cancel()
    const fromRow = this.visualRow(trackId)
    if (fromRow === -1) return
    this.gesture = {
      trackId,
      pointerId: event.pointerId,
      fromRow,
      targetRow: fromRow,
      startClientY: event.clientY,
      startScrollTop: this.scrollerRef.current?.scrollTop ?? 0,
      lastClientY: event.clientY,
      active: false,
      rows: [],
      capture: event.currentTarget,
    }
    this.listening = new AbortController()
    const { signal } = this.listening
    window.addEventListener('pointermove', this.onPointerMove, { signal })
    window.addEventListener('pointerup', this.onPointerUp, { signal })
    window.addEventListener('pointercancel', this.onPointerCancel, { signal })
    window.addEventListener('keydown', this.onKeyDown, { signal, capture: true })
    window.addEventListener('blur', () => this.finish(false, false), { signal })
  }

  nudge(trackId: TrackId, rows: -1 | 1): void {
    const row = this.visualRow(trackId)
    const targetRow = row + rows
    if (row === -1 || targetRow < 0 || targetRow >= this.engine.project.tracks.length) return
    if (!this.dispatch(trackId, targetRow)) return
    requestAnimationFrame(() => {
      this.scrollerRef.current?.querySelector<HTMLElement>(`[data-mcut-track-grip="${CSS.escape(trackId)}"]`)?.focus()
    })
  }

  dispose(): void {
    this.cancel()
    this.clearTransitionReset()
  }

  private clearTransitionReset(): void {
    if (this.transitionReset === null) return
    clearTimeout(this.transitionReset)
    this.transitionReset = null
  }

  private visualRow(trackId: TrackId): number {
    const index = this.engine.project.tracks.findIndex((track) => track.id === trackId)
    return index === -1 ? -1 : this.engine.project.tracks.length - 1 - index
  }

  private dispatch(trackId: TrackId, targetRow: number): boolean {
    try {
      this.engine.dispatch(reorderCommand(this.engine, trackId, targetRow))
      return true
    } catch (error) {
      rethrowUnlessRejected(error)
      return false
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    const gesture = this.gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if ((event.buttons & 1) === 0) {
      this.finish(true)
      return
    }
    gesture.lastClientY = event.clientY
    if (!gesture.active) {
      if (Math.abs(event.clientY - gesture.startClientY) < DRAG_THRESHOLD_PX) return
      this.activate(gesture)
    }
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.update()
    })
  }

  private onPointerUp = (event: PointerEvent) => {
    if (this.gesture?.pointerId === event.pointerId) this.finish(true)
  }

  private onPointerCancel = (event: PointerEvent) => {
    if (this.gesture?.pointerId === event.pointerId) this.finish(false, false)
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.gesture) return
    event.preventDefault()
    event.stopPropagation()
    this.finish(false, false)
  }

  private activate(gesture: TrackGesture): void {
    const scroller = this.scrollerRef.current
    gesture.active = true
    this.clearTransitionReset()
    gesture.rows = scroller ? [...scroller.querySelectorAll<HTMLElement>('[data-mcut-track-row]')] : []
    const shift = `translate ${ROW_SHIFT_MS}ms ${motionEase('--ease-out')}`
    for (const [row, node] of gesture.rows.entries()) {
      node.style.transition = row === gesture.fromRow ? '' : shift
      node.toggleAttribute('data-dragging', row === gesture.fromRow)
    }
    try {
      gesture.capture.setPointerCapture(gesture.pointerId)
    } catch (error) {
      if (!(error instanceof DOMException)) throw error
    }
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    this.autoScroll.start({
      scroller,
      bounds: { left: rect.left, right: rect.right, top: rect.top + RULER_HEIGHT, bottom: rect.bottom },
      pointer: () => (this.gesture === gesture ? { x: rect.left + rect.width / 2, y: gesture.lastClientY } : null),
      axes: { x: false, y: true },
      onScroll: () => this.update(),
    })
  }

  private offsetPx(gesture: TrackGesture): number {
    const scrollDy = (this.scrollerRef.current?.scrollTop ?? gesture.startScrollTop) - gesture.startScrollTop
    const raw = gesture.lastClientY - gesture.startClientY + scrollDy
    const last = gesture.rows.length - 1
    return Math.max(-gesture.fromRow * TRACK_HEIGHT, Math.min((last - gesture.fromRow) * TRACK_HEIGHT, raw))
  }

  private update(): void {
    const gesture = this.gesture
    if (!gesture?.active) return
    const offset = this.offsetPx(gesture)
    const targetRow = Math.round(gesture.fromRow + offset / TRACK_HEIGHT)
    gesture.rows[gesture.fromRow]?.style.setProperty('translate', `0px ${offset}px`)
    if (targetRow === gesture.targetRow) return
    gesture.targetRow = targetRow
    for (const [row, node] of gesture.rows.entries()) {
      if (row === gesture.fromRow) continue
      const shift =
        gesture.fromRow < targetRow && row > gesture.fromRow && row <= targetRow
          ? -1
          : gesture.fromRow > targetRow && row >= targetRow && row < gesture.fromRow
            ? 1
            : 0
      node.style.translate = shift === 0 ? '' : `0px ${shift * TRACK_HEIGHT}px`
    }
  }

  private finish(commit: boolean, animate = true): void {
    const gesture = this.gesture
    if (!gesture) return
    if (gesture.active && this.frame !== null) this.update()
    this.cancel()
    if (!gesture.active) return
    const offset = this.offsetPx(gesture)
    const moved = commit && gesture.targetRow !== gesture.fromRow && this.dispatch(gesture.trackId, gesture.targetRow)
    const dragged = gesture.rows[gesture.fromRow]
    for (const node of gesture.rows) {
      if (node === dragged) continue
      if (moved || !animate) node.style.transition = ''
      node.style.translate = ''
    }
    if (dragged) {
      dragged.style.translate = ''
      dragged.removeAttribute('data-dragging')
    }
    if (!moved && animate) {
      this.transitionReset = setTimeout(() => {
        this.transitionReset = null
        for (const node of gesture.rows) node.style.transition = ''
      }, ROW_SHIFT_MS)
    }
    if (!animate) return
    requestAnimationFrame(() => {
      if (!dragged) return
      const landedRow = moved ? gesture.targetRow : gesture.fromRow
      glide(dragged, { x: 0, y: gesture.fromRow * TRACK_HEIGHT + offset - landedRow * TRACK_HEIGHT }, SETTLE_MS, moved ? '--ease-out' : '--ease-in-out')
    })
  }

  private cancel(): void {
    const gesture = this.gesture
    this.gesture = null
    this.listening?.abort()
    this.listening = null
    this.autoScroll.stop()
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
    if (gesture?.capture.hasPointerCapture(gesture.pointerId)) gesture.capture.releasePointerCapture(gesture.pointerId)
  }
}

const TrackDragContext = createContext<TrackDragController | null>(null)

export const TrackDragProvider = TrackDragContext.Provider

export function useTrackDragController(): TrackDragController {
  const engine = useEditor()
  const { timelineScrollRef } = useEditorUI()
  return useDisposable(() => new TrackDragController(engine, timelineScrollRef))
}

export function useTrackDrag(): TrackDragController {
  const controller = useContext(TrackDragContext)
  if (!controller) throw new Error('useTrackDrag must be used inside <TrackDragProvider>')
  return controller
}
