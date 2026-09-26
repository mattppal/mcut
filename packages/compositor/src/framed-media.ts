import { getZoomWindow, type ContentView, type Crop, type FrameStyle, type LayoutSlot, type VisibleFraction } from '@mcut/timeline'
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

function cropSourceRect(crop: Crop | undefined, frame: CanvasImageSource): SourceRect | null {
  if (!crop) return null
  const { width: fw, height: fh } = getImageSize(frame)
  if (fw <= 0 || fh <= 0) return null
  return { sx: crop.x * fw, sy: crop.y * fh, sw: crop.w * fw, sh: crop.h * fh }
}

const windowOf = (base: SourceRect, part: LayoutSlot['rect']): SourceRect => ({
  sx: base.sx + part.x * base.sw,
  sy: base.sy + part.y * base.sh,
  sw: part.w * base.sw,
  sh: part.h * base.sh,
})

export function viewSourceRect(crop: Crop | undefined, frame: CanvasImageSource, view: ContentView): SourceRect | null {
  const cropped = cropSourceRect(crop, frame)
  if (view.scale === 1) return cropped
  const { width, height } = getImageSize(frame)
  return windowOf(cropped ?? { sx: 0, sy: 0, sw: width, sh: height }, getZoomWindow(view))
}

export const frameRadius = (style: FrameStyle, box: { w: number; h: number }): number => (style.cornerRadius ?? 0) * Math.min(box.w, box.h)

export function withFrameChrome(ctx: Canvas2D, style: FrameStyle, box: FrameBox, draw: () => void): void {
  const radius = frameRadius(style, box)
  const tracePath = () => {
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.w, box.h, radius)
  }
  if (style.shadow) {
    ctx.save()
    ctx.shadowColor = style.shadow.color
    ctx.shadowBlur = style.shadow.blur
    ctx.shadowOffsetX = style.shadow.offsetX
    ctx.shadowOffsetY = style.shadow.offsetY
    ctx.fillStyle = '#000'
    tracePath()
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  if (radius > 0) {
    tracePath()
    ctx.clip()
  }
  draw()
  ctx.restore()
  if (style.stroke) {
    ctx.save()
    tracePath()
    ctx.clip()
    ctx.strokeStyle = style.stroke.color
    ctx.lineWidth = style.stroke.width * 2
    tracePath()
    ctx.stroke()
    ctx.restore()
  }
}

function placeSource(base: SourceRect, box: FrameBox, fit: LayoutSlot['fit'], viewFor: ViewFor): { src: SourceRect; dest: FrameBox } {
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

export function drawFramedMedia(ctx: Canvas2D, frame: CanvasImageSource, box: FrameBox, style: FrameStyle, fit: LayoutSlot['fit'], viewFor: ViewFor): void {
  const { width, height } = getImageSize(frame)
  if (width <= 0 || height <= 0) return
  const { src, dest } = placeSource(cropSourceRect(style.crop, frame) ?? { sx: 0, sy: 0, sw: width, sh: height }, box, fit, viewFor)
  withFrameChrome(ctx, style, box, () => ctx.drawImage(frame, src.sx, src.sy, src.sw, src.sh, dest.x, dest.y, dest.w, dest.h))
}
