import type { KeyframeMap } from './keyframes'
import type { LayoutSlot } from './layouts'
import type { MulticamElement, Project, Transform, VideoElement } from './model'
import { getClipView, zoomRegionEndMs, type ContentView } from './zoom-regions'

const TOLERANCE_PX = 0.5
const MIN_SHUTTER_ANGLE = 15
const REST: ContentView = { scale: 1, focus: { x: 0.5, y: 0.5 } }

type Box = Pick<Transform, 'x' | 'y' | 'scaleX' | 'scaleY'>

interface SlotClip {
  element: MulticamElement
  fromMs: number
  toMs: number
  rect: LayoutSlot['rect']
  fitScale: number
  size: { width: number; height: number }
}

const lerpBox = (a: Box, b: Box, t: number): Box => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  scaleX: a.scaleX + (b.scaleX - a.scaleX) * t,
  scaleY: a.scaleY + (b.scaleY - a.scaleY) * t,
})

export function flattenSlotMotion(project: Project, clip: SlotClip): Pick<VideoElement, 'transform' | 'keyframes' | 'motionBlur'> {
  const { element, fromMs, toMs, rect, size } = clip
  const boxIn = ({ scale, focus }: ContentView): Box => ({
    x: (scale * (rect.x + rect.w / 2 - focus.x * (1 - 1 / scale)) - 0.5) * project.width,
    y: (scale * (rect.y + rect.h / 2 - focus.y * (1 - 1 / scale)) - 0.5) * project.height,
    scaleX: clip.fitScale * scale,
    scaleY: clip.fitScale * scale,
  })
  const transform = { ...boxIn(REST), rotation: 0 }
  const regions = (element.zooms ?? []).filter((z) => z.source === undefined && z.atMs < toMs && zoomRegionEndMs(z) > fromMs)
  if (regions.length === 0) return { transform }

  const boxAt = (localMs: number) => boxIn(getClipView(element, element.startMs + localMs))
  const errorPx = (a: Box, b: Box) =>
    Math.max(Math.abs(a.x - b.x) + (Math.abs(a.scaleX - b.scaleX) * size.width) / 2, Math.abs(a.y - b.y) + (Math.abs(a.scaleY - b.scaleY) * size.height) / 2)
  const keys = new Map<number, Box>()
  const key = (ms: number) => {
    const box = keys.get(ms) ?? boxAt(ms)
    keys.set(ms, box)
    return box
  }
  const missesPx = (a: number, b: number, ms: number) => errorPx(boxAt(ms), lerpBox(key(a), key(b), (ms - a) / (b - a)))
  const refine = (a: number, b: number): void => {
    if (b - a < 2) return
    const mid = Math.round((a + b) / 2)
    if ([a + (b - a) / 4, mid, b - (b - a) / 4].every((ms) => missesPx(a, b, ms) <= TOLERANCE_PX)) return
    key(mid)
    refine(a, mid)
    refine(mid, b)
  }
  const clamp = (ms: number) => Math.min(toMs, Math.max(fromMs, ms))
  const frameMs = 1000 / project.fps
  for (const zoom of regions) {
    const inEndMs = zoom.atMs + zoom.inMs
    const outStartMs = inEndMs + zoom.holdMs
    for (const [startMs, endMs] of [
      [zoom.atMs, inEndMs],
      [outStartMs, zoomRegionEndMs(zoom)],
    ] as const) {
      const grid = [clamp(startMs)]
      for (let k = 1; startMs + k * frameMs < endMs; k++) grid.push(clamp(Math.round(startMs + k * frameMs)))
      grid.push(clamp(endMs))
      grid.forEach(key)
      grid.forEach((ms, i) => refine(ms, grid[i + 1] ?? ms))
    }
  }

  const sorted = [...keys.entries()].sort(([a], [b]) => a - b)
  const track = (pick: (box: Box) => number) => sorted.map(([ms, box]) => ({ timeMs: ms - fromMs, value: pick(box) }))
  const keyframes: KeyframeMap = {
    'position.x': track((box) => box.x),
    'position.y': track((box) => box.y),
    'scale.x': track((box) => box.scaleX),
    'scale.y': track((box) => box.scaleY),
  }
  const shutter = Math.max(...regions.map((z) => z.motionBlur))
  return { transform, keyframes, ...(shutter > 0 && { motionBlur: { enabled: true, shutterAngle: Math.max(MIN_SHUTTER_ANGLE, shutter * 360) } }) }
}
