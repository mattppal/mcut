import type { ContentView, Crop, FrameStyle, LayoutSlot, VisibleFraction } from '@mcut/timeline'
import type { Canvas2D } from './types'
import { applyView, type SourceRect } from './zoom-views'

export interface FrameBox {
  x: number
  y: number
  w: number
  h: number
}

type MediaFit = LayoutSlot['fit'] | 'fill'

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

export function viewSourceRect(crop: Crop | undefined, frame: CanvasImageSource, view: ContentView): SourceRect | null {
  const cropped = cropSourceRect(crop, frame)
  if (view.scale === 1) return cropped
  const { width, height } = getImageSize(frame)
  return applyView(cropped ?? { sx: 0, sy: 0, sw: width, sh: height }, view)
}

export const frameRadius = (style: FrameStyle, box: { w: number; h: number }): number => (style.cornerRadius ?? 0) * Math.min(box.w, box.h)

function withFrameChrome(ctx: Canvas2D, style: FrameStyle, box: FrameBox, draw: () => void): void {
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

function placeSource(base: SourceRect, box: FrameBox, fit: MediaFit, viewFor: ViewFor): { src: SourceRect; dest: FrameBox } {
  if (fit === 'fill') return { src: applyView(base, viewFor({ x: 1, y: 1 })), dest: box }
  const fitScale = fit === 'cover' ? Math.max(box.w / base.sw, box.h / base.sh) : Math.min(box.w / base.sw, box.h / base.sh)
  const view = viewFor({ x: box.w / (fitScale * base.sw), y: box.h / (fitScale * base.sh) })
  const scale = fitScale * view.scale
  const sw = Math.min(base.sw, box.w / scale)
  const sh = Math.min(base.sh, box.h / scale)
  const dw = sw * scale
  const dh = sh * scale
  return {
    src: { sx: base.sx + (base.sw - sw) * view.focus.x, sy: base.sy + (base.sh - sh) * view.focus.y, sw, sh },
    dest: { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, w: dw, h: dh },
  }
}

export function drawFramedMedia(ctx: Canvas2D, frame: CanvasImageSource, box: FrameBox, style: FrameStyle, fit: MediaFit, viewFor: ViewFor): void {
  const { width, height } = getImageSize(frame)
  if (width <= 0 || height <= 0) return
  const { src, dest } = placeSource(cropSourceRect(style.crop, frame) ?? { sx: 0, sy: 0, sw: width, sh: height }, box, fit, viewFor)
  withFrameChrome(ctx, style, box, () => ctx.drawImage(frame, src.sx, src.sy, src.sw, src.sh, dest.x, dest.y, dest.w, dest.h))
}
