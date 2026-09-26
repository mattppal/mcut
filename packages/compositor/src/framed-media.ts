import { getZoomWindow, type ContentView, type Crop, type FrameStyle, type LayoutSlot, type Shadow, type Stroke, type VisibleFraction } from '@mcut/timeline'
import type { Canvas2D } from './types'

export interface FrameBox {
  x: number
  y: number
  w: number
  h: number
}

export interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

type ViewFor = (visible: VisibleFraction) => ContentView

export function getImageSize(source: CanvasImageSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  if ('displayWidth' in source) {
    return { width: source.displayWidth, height: source.displayHeight }
  }
  return { width: lengthInPixels(source.width), height: lengthInPixels(source.height) }
}

function lengthInPixels(length: number | SVGAnimatedLength): number {
  return typeof length === 'number' ? length : length.baseVal.value
}

export function cropSourceRect(crop: Crop | undefined, { width, height }: { width: number; height: number }): SourceRect | null {
  if (!crop || width <= 0 || height <= 0) return null
  return { sx: crop.x * width, sy: crop.y * height, sw: crop.w * width, sh: crop.h * height }
}

const windowOf = (base: SourceRect, part: LayoutSlot['rect']): SourceRect => ({
  sx: base.sx + part.x * base.sw,
  sy: base.sy + part.y * base.sh,
  sw: part.w * base.sw,
  sh: part.h * base.sh,
})

export function viewSourceRect(crop: Crop | undefined, frame: CanvasImageSource, view: ContentView): SourceRect | null {
  const size = getImageSize(frame)
  const cropped = cropSourceRect(crop, size)
  if (view.scale === 1) return cropped
  return windowOf(cropped ?? { sx: 0, sy: 0, sw: size.width, sh: size.height }, getZoomWindow(view))
}

export const frameRadius = (style: FrameStyle, box: { w: number; h: number }): number => (style.cornerRadius ?? 0) * Math.min(box.w, box.h)

function tracePath(ctx: Canvas2D, box: FrameBox, radius: number): void {
  ctx.beginPath()
  ctx.roundRect(box.x, box.y, box.w, box.h, radius)
}

export function drawFrameShadow(ctx: Canvas2D, shadow: Shadow, box: FrameBox, radius: number): void {
  ctx.save()
  ctx.shadowColor = shadow.color
  ctx.shadowBlur = shadow.blur
  ctx.shadowOffsetX = shadow.offsetX
  ctx.shadowOffsetY = shadow.offsetY
  ctx.fillStyle = '#000'
  tracePath(ctx, box, radius)
  ctx.fill()
  ctx.restore()
}

export function drawFrameStroke(ctx: Canvas2D, stroke: Stroke, box: FrameBox, radius: number): void {
  ctx.save()
  tracePath(ctx, box, radius)
  ctx.clip()
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.width * 2
  tracePath(ctx, box, radius)
  ctx.stroke()
  ctx.restore()
}

export function withFrameChrome(ctx: Canvas2D, style: FrameStyle, box: FrameBox, draw: () => void): void {
  const radius = frameRadius(style, box)
  if (style.shadow) drawFrameShadow(ctx, style.shadow, box, radius)
  ctx.save()
  if (radius > 0) {
    tracePath(ctx, box, radius)
    ctx.clip()
  }
  draw()
  ctx.restore()
  if (style.stroke) drawFrameStroke(ctx, style.stroke, box, radius)
}

export function placeSource(base: SourceRect, box: FrameBox, fit: LayoutSlot['fit'], viewFor: ViewFor): { src: SourceRect; dest: FrameBox } {
  const fitScale = fit === 'cover' ? Math.max(box.w / base.sw, box.h / base.sh) : Math.min(box.w / base.sw, box.h / base.sh)
  const visible = { x: box.w / (fitScale * base.sw), y: box.h / (fitScale * base.sh) }
  const view = viewFor(visible)
  const shown = getZoomWindow(view, visible)
  const src = windowOf(base, { x: Math.max(0, shown.x), y: Math.max(0, shown.y), w: Math.min(1, shown.w), h: Math.min(1, shown.h) })
  const scale = fitScale * view.scale
  const dw = src.sw * scale
  const dh = src.sh * scale
  return { src, dest: { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, w: dw, h: dh } }
}
