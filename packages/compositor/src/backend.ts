import {
  buildFilterString,
  toCompositeOperation,
  type BlendMode,
  type Effect,
  type Project,
  type Track,
} from '@mcut/timeline'
import type { Canvas2D, ElementRenderContext, FrameSource } from './types'

/**
 * The draw layer renderFrame composites through. The track/element walk,
 * transition pairing, and geometry in render-frame.ts are renderer-agnostic;
 * backends own how pixels actually land:
 *
 *  - {@link Canvas2DBackend} — the original canvas2d path. The reference
 *    implementation: tests run against it (FakeContext2D), and headless/Node
 *    environments use it. Not a runtime fallback once WebGPU is the default.
 *  - WebGPUBackend (webgpu/) — image quads composite as textured passes with
 *    WGSL effects; raster content (text, captions, multicam chrome, custom
 *    renderers) still paints through canvas2d in frame space and uploads as
 *    a texture layer, preserving output across backends.
 *
 * Determinism contract: for a given backend, the same project, time, and
 * frame source produce the same pixels in preview and export. Across
 * backends, output is perceptually identical (GPU float math differs at the
 * ULP level), so golden tests compare with tolerance, not byte equality.
 */

/** Resolved element chrome: transform in frame coords + compositing state. */
export interface LayerChrome {
  /** Element center in canvas coordinates. */
  centerX: number
  centerY: number
  rotationDeg: number
  scaleX: number
  scaleY: number
  /** 0..1, multiplied into the layer. */
  opacity: number
  blendMode?: BlendMode | undefined
  effects?: readonly Effect[] | undefined
}

/** A plain media draw: one image into a centered rect, optional crop/radius. */
export interface ImageQuad {
  image: CanvasImageSource
  /** Source crop rect in image pixels; null draws the whole image. */
  src: { sx: number; sy: number; sw: number; sh: number } | null
  /** Destination size, centered on the chrome's origin. */
  dw: number
  dh: number
  /** Rounded-corner radius in destination pixels (0 = sharp). */
  cornerRadius: number
}

export interface RenderBackend {
  readonly kind: 'canvas2d' | 'webgpu' | (string & {})
  readonly width: number
  readonly height: number
  beginFrame(backgroundColor: string): void
  endFrame(): void
  /**
   * The frame-space canvas2d context for raster content. Acquiring it marks
   * the raster surface dirty so the backend composites it in z-order;
   * renderers that only need it for text measurement still go through here
   * (text rasterizes anyway).
   */
  acquireRaster(): Canvas2D
  /**
   * Composite a media quad with chrome — the GPU fast path. Backends without
   * one (or layers a backend cannot run, e.g. raw `css` filters on WebGPU)
   * draw it through the raster context instead.
   */
  drawImageQuad(quad: ImageQuad, chrome: LayerChrome): void
  /**
   * While a raster scope is open, every draw — including image quads — lands
   * on the raster context, so canvas2d state (clips, alpha, transforms) set
   * by the caller applies. Transition mixes and motion-blur accumulation
   * need this. Scopes nest.
   */
  pushRasterScope(): void
  popRasterScope(): void
}

/**
 * Transform + opacity + effect-stack filter + blend mode around a canvas2d
 * draw (the original withTransform). `ctx.filter` is unsupported in some
 * older engines; there the stack degrades to an unfiltered render rather
 * than failing.
 */
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

/** Draw an {@link ImageQuad} in local (chrome-applied) coordinates. */
export function drawImageQuad2D(ctx: Canvas2D, quad: ImageQuad): void {
  ctx.save()
  if (quad.cornerRadius > 0) {
    ctx.beginPath()
    ctx.roundRect(-quad.dw / 2, -quad.dh / 2, quad.dw, quad.dh, quad.cornerRadius)
    ctx.clip()
  }
  if (quad.src) {
    ctx.drawImage(
      quad.image,
      quad.src.sx,
      quad.src.sy,
      quad.src.sw,
      quad.src.sh,
      -quad.dw / 2,
      -quad.dh / 2,
      quad.dw,
      quad.dh,
    )
  } else {
    ctx.drawImage(quad.image, -quad.dw / 2, -quad.dh / 2, quad.dw, quad.dh)
  }
  ctx.restore()
}

/** The canvas2d backend: draws straight into the target context. */
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

/**
 * Build the per-element render context. `ctx` is a getter so backends learn
 * when raster content is actually being drawn (GPU backends flush the
 * raster surface lazily, in z-order).
 */
export function createElementContext(
  backend: RenderBackend,
  project: Project,
  track: Track,
  timeMs: number,
  source: FrameSource | undefined,
): ElementRenderContext {
  return {
    backend,
    project,
    track,
    timeMs,
    source,
    get ctx() {
      return backend.acquireRaster()
    },
  }
}
