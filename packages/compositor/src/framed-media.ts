import type { Crop, FrameStyle, LayoutSlot } from '@mcut/timeline'
import type { Canvas2D } from './types'

export interface FrameBox {
  x: number
  y: number
  w: number
  h: number
}

interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

type MediaFit = LayoutSlot['fit'] | 'fill'

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

export function cropSourceRect(crop: Crop | undefined, frame: CanvasImageSource): SourceRect | null {
  if (!crop) return null
  const { width: fw, height: fh } = getImageSize(frame)
  if (fw <= 0 || fh <= 0) return null
  return { sx: crop.x * fw, sy: crop.y * fh, sw: crop.w * fw, sh: crop.h * fh }
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

function fitSource(src: SourceRect, box: FrameBox, fit: MediaFit): { src: SourceRect; dest: FrameBox } {
  if (fit === 'fill') return { src, dest: box }
  const scale = fit === 'cover' ? Math.max(box.w / src.sw, box.h / src.sh) : Math.min(box.w / src.sw, box.h / src.sh)
  const sw = Math.min(src.sw, box.w / scale)
  const sh = Math.min(src.sh, box.h / scale)
  const dw = sw * scale
  const dh = sh * scale
  return {
    src: { sx: src.sx + (src.sw - sw) / 2, sy: src.sy + (src.sh - sh) / 2, sw, sh },
    dest: { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, w: dw, h: dh },
  }
}

export function drawFramedMedia(ctx: Canvas2D, frame: CanvasImageSource, box: FrameBox, style: FrameStyle, fit: MediaFit): void {
  const { width, height } = getImageSize(frame)
  if (width <= 0 || height <= 0) return
  const { src, dest } = fitSource(cropSourceRect(style.crop, frame) ?? { sx: 0, sy: 0, sw: width, sh: height }, box, fit)
  withFrameChrome(ctx, style, box, () => ctx.drawImage(frame, src.sx, src.sy, src.sw, src.sh, dest.x, dest.y, dest.w, dest.h))
}

export function drawFramedComposite(ctx: Canvas2D, size: { width: number; height: number }, style: FrameStyle, draw: () => void): void {
  const crop = style.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const box = { x: (-crop.w * size.width) / 2, y: (-crop.h * size.height) / 2, w: crop.w * size.width, h: crop.h * size.height }
  withFrameChrome(ctx, style, box, () => {
    if (style.crop) {
      ctx.beginPath()
      ctx.rect(box.x, box.y, box.w, box.h)
      ctx.clip()
      ctx.translate((0.5 - crop.x - crop.w / 2) * size.width, (0.5 - crop.y - crop.h / 2) * size.height)
    }
    draw()
  })
}
