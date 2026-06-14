import {
  resolveAnimatedElement,
  toCompositeOperation,
  type MotionBlur,
  type Project,
  type TimelineElement,
  type Track,
} from '@mcut/timeline'
import { Canvas2DBackend, createElementContext, type RenderBackend } from './backend'
import type { Canvas2D, ElementRenderer, RenderFrameOptions } from './types'

/**
 * Per-element motion blur, After Effects' layer model: the element renders
 * N times at sub-frame moments inside a shutter window centered on the
 * frame, each pass at 1/N alpha, accumulated additively in a scratch canvas
 * and composited once. Deterministic — sample times derive only from the
 * frame time and project fps, so preview, scrubbing in any order, and export
 * all blur identically.
 *
 * Only KEYFRAMED transform motion blurs (the keyframes give us the
 * sub-frame transforms analytically); static clips and motion inside the
 * source footage are untouched. Video sub-samples reuse the single source
 * frame at the frame's center time — only the transform sweeps.
 */

const TRANSFORM_PROPERTIES = ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation'] as const

const DEFAULT_SAMPLES = 8

/** Movement gates: skip the N-pass cost when travel inside the window is invisible. */
const MIN_TRAVEL_PX = 0.75
const MIN_ROTATION_DEG = 0.05
const MIN_SCALE_DELTA = 0.002

function getMotionBlur(element: TimelineElement): MotionBlur | undefined {
  return 'motionBlur' in element ? element.motionBlur : undefined
}

function hasTransformMotion(element: TimelineElement): boolean {
  const keyframes = 'keyframes' in element ? element.keyframes : undefined
  if (!keyframes) return false
  return TRANSFORM_PROPERTIES.some((property) => (keyframes[property]?.length ?? 0) >= 2)
}

function isMovingBetween(element: TimelineElement, t0: number, t1: number): boolean {
  const a = resolveAnimatedElement(element, t0)
  const b = resolveAnimatedElement(element, t1)
  if (!('transform' in a) || !('transform' in b)) return false
  const from = a.transform
  const to = b.transform
  if (Math.hypot(to.x - from.x, to.y - from.y) >= MIN_TRAVEL_PX) return true
  if (Math.abs(to.rotation - from.rotation) >= MIN_ROTATION_DEG) return true
  return (
    Math.abs(to.scaleX - from.scaleX) >= MIN_SCALE_DELTA ||
    Math.abs(to.scaleY - from.scaleY) >= MIN_SCALE_DELTA
  )
}

/** Cached accumulation surface; cleared before every use, so reuse is safe. */
let cachedScratch: Canvas2D | null = null

function acquireScratch(
  width: number,
  height: number,
  options: RenderFrameOptions,
): Canvas2D | null {
  if (options.createScratchContext) return options.createScratchContext(width, height)
  if (typeof OffscreenCanvas === 'undefined') return null
  const cachedCanvas = cachedScratch?.canvas as OffscreenCanvas | undefined
  if (!cachedScratch || cachedCanvas?.width !== width || cachedCanvas?.height !== height) {
    const ctx = new OffscreenCanvas(width, height).getContext('2d')
    if (!ctx) return null
    cachedScratch = ctx as Canvas2D
  }
  return cachedScratch
}

/**
 * Render `element` with motion blur into `ctx`. Returns false when motion
 * blur does not apply (off, no keyframed transform motion, sub-threshold
 * travel, or no scratch surface available) — the caller then renders the
 * plain single-sample pass.
 */
export function renderElementWithMotionBlur(
  backend: RenderBackend,
  project: Project,
  track: Track,
  element: TimelineElement,
  timeMs: number,
  options: RenderFrameOptions,
  renderer: ElementRenderer,
): boolean {
  const blur = getMotionBlur(element)
  if (!blur?.enabled) return false
  if (!hasTransformMotion(element)) return false
  const windowMs = (1000 / project.fps) * (blur.shutterAngle / 360)
  if (!(windowMs > 0)) return false
  const start = timeMs - windowMs / 2
  if (!isMovingBetween(element, start, start + windowMs)) return false
  const scratch = acquireScratch(project.width, project.height, options)
  if (!scratch) return false

  const samples = Math.max(2, Math.min(64, Math.round(options.motionBlurSamples ?? DEFAULT_SAMPLES)))
  scratch.clearRect(0, 0, project.width, project.height)
  scratch.save()
  // Additive accumulation: N passes at 1/N alpha sum to the element's own
  // coverage wherever the samples overlap. The sub-passes always render
  // through a canvas2d backend over the scratch — accumulation is a raster
  // process regardless of the outer backend.
  scratch.globalCompositeOperation = 'lighter'
  scratch.globalAlpha = 1 / samples
  const subBackend = new Canvas2DBackend(scratch, project.width, project.height)
  for (let i = 0; i < samples; i++) {
    const resolved = resolveAnimatedElement(element, start + windowMs * ((i + 0.5) / samples))
    // The element's blend mode applies once at the composite below; inside
    // the scratch the passes must stay additive.
    const sub =
      'blendMode' in resolved && resolved.blendMode
        ? { ...resolved, blendMode: undefined }
        : resolved
    // Center frame time → video sub-samples reuse one decoded source frame.
    renderer(sub, createElementContext(subBackend, project, track, timeMs, options.source))
  }
  scratch.restore()

  const ctx = backend.acquireRaster()
  ctx.save()
  const blendMode = 'blendMode' in element ? element.blendMode : undefined
  if (blendMode) ctx.globalCompositeOperation = toCompositeOperation(blendMode)
  ctx.drawImage(scratch.canvas, 0, 0)
  ctx.restore()
  return true
}
