import { type ClipDragBase } from '@mcut/editor'
import { getElementLocation, type ElementId, type Project } from '@mcut/timeline'
import { NEW_TRACK_ABOVE_ROW, visualRow, type ClipPreview, type DragPlan } from './timeline-drag-plan'

export const TRACK_HEIGHT = 56
export const RULER_HEIGHT = 28
export const NEW_TRACK_LANE_HEIGHT = 36

const SETTLE_MS = 180
const RETURN_MS = 240
export const ROW_SHIFT_MS = 150

type EaseToken = '--ease-out' | '--ease-in-out'

export function motionEase(token: EaseToken): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return value === '' ? 'ease-out' : value
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function rowCenterPx(row: number): number {
  return row === NEW_TRACK_ABOVE_ROW ? -NEW_TRACK_LANE_HEIGHT / 2 : row * TRACK_HEIGHT + TRACK_HEIGHT / 2
}

interface Glide {
  x: number
  y: number
  width?: { from: number; to: number }
}

export function glide(node: HTMLElement, from: Glide, durationMs: number, token: EaseToken): void {
  if (Math.abs(from.x) < 0.5 && Math.abs(from.y) < 0.5 && from.width === undefined) return
  if (prefersReducedMotion()) return
  const width = from.width
  node.animate(
    [
      { translate: `${from.x}px ${from.y}px`, ...(width ? { width: `${width.from}px` } : {}) },
      { translate: '0px 0px', ...(width ? { width: `${width.to}px` } : {}) },
    ],
    { duration: durationMs, easing: motionEase(token) },
  )
}

function clipWidthPx(durationMs: number, pxPerMs: number): number {
  return Math.max(10, durationMs * pxPerMs)
}

export class ClipPreviewLayer {
  private readonly nodes = new Map<ElementId, { node: HTMLElement; width: string }>()
  private readonly lanes = new Map<string, HTMLElement>()
  private readonly newTrackLane: HTMLElement | null
  private highlighted: HTMLElement | null = null

  constructor(private readonly root: HTMLElement) {
    for (const lane of root.querySelectorAll<HTMLElement>('[data-mcut-lane]')) {
      const trackId = lane.dataset.mcutLane
      if (trackId) this.lanes.set(trackId, lane)
    }
    this.newTrackLane = root.querySelector<HTMLElement>('[data-mcut-new-track-lane]')
  }

  private clipNode(id: ElementId): HTMLElement | null {
    const known = this.nodes.get(id)
    if (known?.node.isConnected) return known.node
    const node = this.root.querySelector<HTMLElement>(`[data-mcut-element-id="${CSS.escape(id)}"]`)
    if (!node) return null
    this.nodes.set(id, { node, width: node.style.width })
    node.setAttribute('data-dragging', '')
    return node
  }

  render(plan: DragPlan, bases: ReadonlyMap<ElementId, ClipDragBase>, project: Project, pxPerMs: number): void {
    for (const preview of plan.previews) {
      const base = bases.get(preview.id)
      const node = this.clipNode(preview.id)
      const entry = this.nodes.get(preview.id)
      if (!base || !node || !entry) continue
      const dx = (preview.startMs - base.startMs) * pxPerMs
      const dy = rowCenterPx(preview.row) - rowCenterPx(visualRow(project, base.trackIndex))
      node.style.translate = `${dx}px ${dy}px`
      node.style.width = preview.durationMs === base.durationMs ? entry.width : `${clipWidthPx(preview.durationMs, pxPerMs)}px`
      node.toggleAttribute('data-drop-invalid', !plan.valid)
    }
    const target = plan.target
    const lane = target === null ? null : target.kind === 'new-track' ? this.newTrackLane : (this.lanes.get(target.trackId) ?? null)
    if (lane !== this.highlighted) this.highlighted?.removeAttribute('data-drop-target')
    this.highlighted = lane
    lane?.setAttribute('data-drop-target', plan.valid ? 'valid' : 'invalid')
  }

  release(): void {
    for (const { node, width } of this.nodes.values()) {
      node.style.translate = ''
      node.style.width = width
      node.removeAttribute('data-dragging')
      node.removeAttribute('data-drop-invalid')
    }
    this.nodes.clear()
    this.highlighted?.removeAttribute('data-drop-target')
    this.highlighted = null
  }

  settle(previews: readonly ClipPreview[], project: () => Project, pxPerMs: number, landed: boolean): void {
    if (previews.length === 0) return
    requestAnimationFrame(() => {
      const after = project()
      for (const preview of previews) {
        const location = getElementLocation(after, preview.id)
        const node = this.root.querySelector<HTMLElement>(`[data-mcut-element-id="${CSS.escape(preview.id)}"]`)
        if (!location || !node) continue
        const { element } = location
        glide(
          node,
          {
            x: (preview.startMs - element.startMs) * pxPerMs,
            y: rowCenterPx(preview.row) - rowCenterPx(visualRow(after, location.trackIndex)),
            ...(preview.durationMs === element.durationMs
              ? {}
              : { width: { from: clipWidthPx(preview.durationMs, pxPerMs), to: clipWidthPx(element.durationMs, pxPerMs) } }),
          },
          landed ? SETTLE_MS : RETURN_MS,
          landed ? '--ease-out' : '--ease-in-out',
        )
      }
    })
  }
}
