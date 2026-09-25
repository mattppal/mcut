import {
  centeredFocus,
  getReframeCenter,
  getSlotView,
  type ContentView,
  type Crop,
  type ImageElement,
  type LayoutSlot,
  type MulticamElement,
  type VideoElement,
  type VisibleFraction,
} from '@mcut/timeline'

interface Point {
  x: number
  y: number
}

function slideCrop(crop: Crop, center: Point): Crop {
  const focus = centeredFocus(center, { x: crop.w, y: crop.h })
  return { ...crop, x: focus.x * (1 - crop.w), y: focus.y * (1 - crop.h) }
}

const withinCrop = (point: Point, crop: Crop): Point => ({ x: (point.x - crop.x) / crop.w, y: (point.y - crop.y) / crop.h })

export function reframedCrop(element: VideoElement | ImageElement, timeMs: number): Crop | undefined {
  const center = element.type === 'video' ? getReframeCenter(element, undefined, timeMs) : null
  const { crop } = element
  return center && crop ? slideCrop(crop, center) : crop
}

export function reframedSlot(
  element: MulticamElement,
  slot: LayoutSlot,
  timeMs: number,
  viewTimeMs: number,
): { slot: LayoutSlot; viewFor: (visible: VisibleFraction) => ContentView } {
  const center = getReframeCenter(element, slot.source, timeMs)
  const framed = center && slot.crop ? { ...slot, crop: slideCrop(slot.crop, center) } : slot
  const subject = center && framed.crop ? withinCrop(center, framed.crop) : center
  return {
    slot: framed,
    viewFor: (visible) => getSlotView(element, slot, viewTimeMs, visible, subject ? centeredFocus(subject, visible) : undefined),
  }
}
