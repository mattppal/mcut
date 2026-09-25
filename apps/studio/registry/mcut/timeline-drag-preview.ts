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

function rowCenterPx(row: number): number {
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
  node.setAttribute('data-settling', '')
  const animation = node.animate(
    [
      { translate: `${from.x}px ${from.y}px`, ...(width ? { width: `${width.from}px` } : {}) },
      { translate: '0px 0px', ...(width ? { width: `${width.to}px` } : {}) },
    ],
    { duration: durationMs, easing: motionEase(token) },
  )
  const lower = () => node.removeAttribute('data-settling')
  animation.addEventListener('finish', lower)
  animation.addEventListener('cancel', lower)
}

function clipWidthPx(durationMs: number, pxPerMs: number): number {
  return Math.max(10, durationMs * pxPerMs)
}

export class ClipPreviewLayer {
  private readonly nodes = new Map<ElementId, HTMLElement>()
  private highlighted: HTMLElement | null = null

  constructor(private readonly root: HTMLElement) {}

  private find(selector: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(selector)
  }

  private clipNode(id: ElementId): HTMLElement | null {
    const known = this.nodes.get(id)
    if (known?.isConnected) return known
    const node = this.find(`[data-mcut-element-id="${CSS.escape(id)}"]`)
    if (!node) return null
    this.nodes.set(id, node)
    node.setAttribute('data-dragging', '')
    return node
  }

  render(plan: DragPlan, bases: ReadonlyMap<ElementId, ClipDragBase>, project: Project, pxPerMs: number): void {
    for (const preview of plan.previews) {
      const base = bases.get(preview.id)
      const node = this.clipNode(preview.id)
      if (!base || !node) continue
      const dx = (preview.startMs - base.startMs) * pxPerMs
      const dy = rowCenterPx(preview.row) - rowCenterPx(visualRow(project, base.trackIndex))
      node.style.translate = `${dx}px ${dy}px`
      node.style.width = `${clipWidthPx(preview.durationMs, pxPerMs)}px`
      node.toggleAttribute('data-drop-invalid', !plan.valid)
    }
    const target = plan.target
    const lane =
      target === null ? null : this.find(target.kind === 'new-track' ? '[data-mcut-new-track-lane]' : `[data-mcut-lane="${CSS.escape(target.trackId)}"]`)
    if (lane !== this.highlighted) this.highlighted?.removeAttribute('data-drop-target')
    this.highlighted = lane
    lane?.setAttribute('data-drop-target', plan.valid ? 'valid' : 'invalid')
  }

  release(project: Project, pxPerMs: number): void {
    for (const [id, node] of this.nodes) {
      const element = getElementLocation(project, id)?.element
      node.style.translate = ''
      if (element) node.style.width = `${clipWidthPx(element.durationMs, pxPerMs)}px`
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
        const node = this.find(`[data-mcut-element-id="${CSS.escape(preview.id)}"]`)
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
