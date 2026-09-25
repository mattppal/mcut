import { buildFilterString, toCompositeOperation, type BlendMode, type Effect, type Project, type Track } from '@mcut/timeline'
import { acquireScratch } from './scratch'
import type { Canvas2D, ElementRenderContext, RenderFrameOptions } from './types'

export interface LayerChrome {
  centerX: number
  centerY: number
  rotationDeg: number
  scaleX: number
  scaleY: number
  opacity: number
  blendMode?: BlendMode | undefined
  effects?: readonly Effect[] | undefined
}

export interface ImageQuad {
  image: CanvasImageSource
  src: { sx: number; sy: number; sw: number; sh: number } | null
  dw: number
  dh: number
  cornerRadius: number
}

export interface RenderBackend {
  readonly kind: 'canvas2d' | 'webgpu' | (string & {})
  readonly width: number
  readonly height: number
  beginFrame(backgroundColor: string): void
  endFrame(): void
  acquireRaster(): Canvas2D
  drawImageQuad(quad: ImageQuad, chrome: LayerChrome): void
  pushRasterScope(): void
  popRasterScope(): void
}

export function applyChrome(ctx: Canvas2D, chrome: LayerChrome, draw: () => void): void {
  ctx.save()
  ctx.globalAlpha *= chrome.opacity
  const filter = buildFilterString(chrome.effects)
  if (filter && 'filter' in ctx) ctx.filter = filter
  if (chrome.blendMode) ctx.globalCompositeOperation = toCompositeOperation(chrome.blendMode)
  ctx.translate(chrome.centerX, chrome.centerY)
  if (chrome.rotationDeg !== 0) ctx.rotate((chrome.rotationDeg * Math.PI) / 180)
  ctx.scale(chrome.scaleX, chrome.scaleY)
  draw()
  ctx.restore()
}

export function drawImageQuad2D(ctx: Canvas2D, quad: ImageQuad): void {
  ctx.save()
  if (quad.cornerRadius > 0) {
    ctx.beginPath()
    ctx.roundRect(-quad.dw / 2, -quad.dh / 2, quad.dw, quad.dh, quad.cornerRadius)
    ctx.clip()
  }
  if (quad.src) {
    ctx.drawImage(quad.image, quad.src.sx, quad.src.sy, quad.src.sw, quad.src.sh, -quad.dw / 2, -quad.dh / 2, quad.dw, quad.dh)
  } else {
    ctx.drawImage(quad.image, -quad.dw / 2, -quad.dh / 2, quad.dw, quad.dh)
  }
  ctx.restore()
}

export class Canvas2DBackend implements RenderBackend {
  readonly kind = 'canvas2d'

  constructor(
    private readonly ctx: Canvas2D,
    readonly width: number,
    readonly height: number,
  ) {}

  beginFrame(backgroundColor: string): void {
    this.ctx.save()
    this.ctx.fillStyle = backgroundColor
    this.ctx.fillRect(0, 0, this.width, this.height)
  }

  endFrame(): void {
    this.ctx.restore()
  }

  acquireRaster(): Canvas2D {
    return this.ctx
  }

  drawImageQuad(quad: ImageQuad, chrome: LayerChrome): void {
    applyChrome(this.ctx, chrome, () => drawImageQuad2D(this.ctx, quad))
  }

  pushRasterScope(): void {}
  popRasterScope(): void {}
}

export function createElementContext(
  backend: RenderBackend,
  project: Project,
  track: Track,
  timeMs: number,
  options: RenderFrameOptions,
  viewTimeMs: number = timeMs,
): ElementRenderContext {
  return {
    backend,
    project,
    track,
    timeMs,
    viewTimeMs,
    source: options.source,
    acquireScratch: (width, height) => acquireScratch('compose', width, height, options),
    get ctx() {
      return backend.acquireRaster()
    },
  }
}
