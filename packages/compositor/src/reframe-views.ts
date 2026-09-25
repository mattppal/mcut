import { centeredFocus, getReframeCenter, type Crop, type ImageElement, type LayoutSlot, type MulticamElement, type VideoElement } from '@mcut/timeline'

export function reframedCrop(element: VideoElement | ImageElement, timeMs: number): Crop | undefined {
  const center = element.type === 'video' ? getReframeCenter(element, undefined, timeMs) : null
  const { crop } = element
  if (!center || !crop) return crop
  const focus = centeredFocus(center, crop)
  return { ...crop, x: focus.x * (1 - crop.w), y: focus.y * (1 - crop.h) }
}

export function reframedSlot(element: MulticamElement, slot: LayoutSlot, window: { w: number; h: number }, timeMs: number): LayoutSlot {
  const center = getReframeCenter(element, slot.source, timeMs)
  return center ? { ...slot, focus: centeredFocus(center, window) } : slot
}
