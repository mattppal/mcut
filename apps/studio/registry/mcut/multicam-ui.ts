import { getActiveAngleIndex, type Crop, type EditorEngine, type LayoutSlot, type MulticamElement, type Project } from '@mcut/timeline'
import { clamp, roundTo } from './math'

interface Size {
  width: number
  height: number
}

export function multicamSourceSize(project: Project, element: MulticamElement | undefined, key: string): Size | null {
  const source = element?.sources.find((s) => s.key === key)
  const asset = source ? project.assets[source.assetId] : undefined
  return asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null
}

export function slotCoverWindow(slot: LayoutSlot, box: Size, source: Size): Crop {
  const crop = slot.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const scale = Math.max(box.width / (crop.w * source.width), box.height / (crop.h * source.height))
  const w = Math.min(crop.w, box.width / scale / source.width)
  const h = Math.min(crop.h, box.height / scale / source.height)
  return { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h }
}

export function panSlotWindow(window: Crop, x: number, y: number): Crop | undefined {
  const w = roundTo(window.w, 4)
  const h = roundTo(window.h, 4)
  const next = { x: roundTo(clamp(x, 0, 1 - w), 4), y: roundTo(clamp(y, 0, 1 - h), 4), w, h }
  return next.x === 0 && next.y === 0 && w === 1 && h === 1 ? undefined : next
}

export interface LocatedMulticam {
  element: MulticamElement
  trackId: Project['tracks'][number]['id']
}

export function findTargetMulticam(project: Project, selectedIds: readonly string[], playheadMs: number): LocatedMulticam | null {
  let underPlayhead: LocatedMulticam | null = null
  let first: LocatedMulticam | null = null
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if (element.type !== 'multicam') continue
      const located = { element, trackId: track.id }
      if (selectedIds.includes(element.id)) return located
      if (!underPlayhead && playheadMs >= element.startMs && playheadMs < element.startMs + element.durationMs) {
        underPlayhead = located
      }
      if (!first) first = located
    }
  }
  return underPlayhead ?? first
}

export function switchToLayout(engine: EditorEngine, element: MulticamElement, layoutId: string): void {
  const playheadMs = engine.playback.state.currentTimeMs
  const localMs = Math.round(playheadMs - element.startMs)
  if (localMs < 0 || localMs >= element.durationMs) return
  try {
    if (engine.playback.state.isPlaying && localMs > 0) {
      engine.dispatch({ type: 'addAngleCut', elementId: element.id, atMs: localMs, layoutId })
    } else {
      const span = element.angles[getActiveAngleIndex(element.angles, localMs)]
      if (!span) return
      engine.dispatch({
        type: 'setAngleLayout',
        elementId: element.id,
        atMs: span.atMs,
        layoutId,
      })
    }
  } catch {}
}
