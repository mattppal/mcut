import { getActiveLayout, isElementActiveAt, type CaptionStyle, type LayoutSlot, type Project } from '@mcut/timeline'

interface Span {
  from: number
  to: number
}

export interface CaptionLane {
  centerX: number
  maxWidth: number
}

const FULL_WIDTH = 0.85
const EDGE_MARGIN = 0.02
const MIN_LANE = 0.4

const overlaps = (a: LayoutSlot['rect'], b: LayoutSlot['rect']) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function reachesBand(rect: LayoutSlot['rect'], position: CaptionStyle['position']): boolean {
  switch (position) {
    case 'bottom':
      return rect.y + rect.h > 0.75
    case 'top':
      return rect.y < 0.25
    case 'middle':
      return false
    default: {
      const unreachable: never = position
      return unreachable
    }
  }
}

function overlaySpans(project: Project, timeMs: number, position: CaptionStyle['position']): Span[] {
  const spans: Span[] = []
  for (const track of project.tracks) {
    if (track.hidden) continue
    for (const element of track.elements) {
      if (element.type !== 'multicam' || !isElementActiveAt(element, timeMs)) continue
      const slots = getActiveLayout(project, element, timeMs)?.slots ?? []
      const { x, y, scaleX, scaleY } = element.transform
      slots.forEach((slot, index) => {
        const pictureInPicture = slots.slice(0, index).some((below) => overlaps(below.rect, slot.rect))
        if (!pictureInPicture) return
        const rect = {
          x: 0.5 + (slot.rect.x - 0.5) * scaleX + x / project.width,
          y: 0.5 + (slot.rect.y - 0.5) * scaleY + y / project.height,
          w: slot.rect.w * scaleX,
          h: slot.rect.h * scaleY,
        }
        if (reachesBand(rect, position)) spans.push({ from: rect.x, to: rect.x + rect.w })
      })
    }
  }
  return spans
}

function widestGap(spans: readonly Span[]): Span {
  let widest: Span = { from: 0, to: 0 }
  let cursor = 0
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    if (span.from - cursor > widest.to - widest.from) widest = { from: cursor, to: span.from }
    cursor = Math.max(cursor, span.to)
  }
  return 1 - cursor > widest.to - widest.from ? { from: cursor, to: 1 } : widest
}

export function getCaptionLane(project: Project, timeMs: number, position: CaptionStyle['position'], padPx: number): CaptionLane {
  const full = { centerX: project.width / 2, maxWidth: project.width * FULL_WIDTH }
  const spans = overlaySpans(project, timeMs, position)
  if (spans.length === 0) return full
  const gap = widestGap(spans)
  const from = Math.max(0, gap.from)
  const to = Math.min(1, gap.to)
  if (to - from < MIN_LANE) return full
  const inset = (EDGE_MARGIN * project.width + padPx) * 2
  return {
    centerX: ((from + to) / 2) * project.width,
    maxWidth: Math.min(full.maxWidth, (to - from) * project.width - inset),
  }
}
