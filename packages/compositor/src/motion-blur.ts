import { getZoomShutterMs, resolveAnimatedElement, toCompositeOperation, type MotionBlur, type Project, type TimelineElement, type Track } from '@mcut/timeline'
import { Canvas2DBackend, createElementContext, type RenderBackend } from './backend'
import type { Canvas2D, ElementRenderer, RenderFrameOptions } from './types'

const TRANSFORM_PROPERTIES = ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation'] as const

const DEFAULT_SAMPLES = 8

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
  return Math.abs(to.scaleX - from.scaleX) >= MIN_SCALE_DELTA || Math.abs(to.scaleY - from.scaleY) >= MIN_SCALE_DELTA
}

function transformShutterMs(element: TimelineElement, timeMs: number, frameMs: number): number {
  const blur = getMotionBlur(element)
  if (!blur?.enabled || !hasTransformMotion(element)) return 0
  const windowMs = frameMs * (blur.shutterAngle / 360)
  if (!(windowMs > 0)) return 0
  const start = timeMs - windowMs / 2
  return isMovingBetween(element, start, start + windowMs) ? windowMs : 0
}

type ScratchRole = 'sample' | 'accumulate'

const cachedScratch = new Map<ScratchRole, OffscreenCanvasRenderingContext2D>()

type ScratchSettings = CanvasRenderingContext2DSettings & { colorType: 'unorm8' | 'float16' }

const SCRATCH_SETTINGS: Record<ScratchRole, ScratchSettings> = {
  sample: { colorType: 'unorm8' },
  accumulate: { colorType: 'float16' },
}

function acquireScratch(role: ScratchRole, width: number, height: number, options: RenderFrameOptions): Canvas2D | null {
  if (options.createScratchContext) return options.createScratchContext(width, height)
  if (typeof OffscreenCanvas === 'undefined') return null
  const cached = cachedScratch.get(role)
  if (cached && cached.canvas.width === width && cached.canvas.height === height) return cached
  const ctx = new OffscreenCanvas(width, height).getContext('2d', SCRATCH_SETTINGS[role])
  if (!ctx) return null
  cachedScratch.set(role, ctx)
  return ctx
}

export function renderElementWithMotionBlur(
  backend: RenderBackend,
  project: Project,
  track: Track,
  element: TimelineElement,
  timeMs: number,
  options: RenderFrameOptions,
  renderer: ElementRenderer,
): boolean {
  const frameMs = 1000 / project.fps
  const transformWindowMs = transformShutterMs(element, timeMs, frameMs)
  const windowMs = Math.max(transformWindowMs, getZoomShutterMs(element, timeMs, frameMs))
  if (!(windowMs > 0)) return false
  const start = timeMs - windowMs / 2
  const renderScale = options.renderScale ?? 1
  const width = Math.max(1, Math.round(project.width * renderScale))
  const height = Math.max(1, Math.round(project.height * renderScale))
  const sample = acquireScratch('sample', width, height, options)
  const accumulate = acquireScratch('accumulate', width, height, options)
  if (!sample || !accumulate) return false

  const samples = Math.max(2, Math.min(64, Math.round(options.motionBlurSamples ?? DEFAULT_SAMPLES)))
  accumulate.clearRect(0, 0, width, height)
  sample.setTransform(renderScale, 0, 0, renderScale, 0, 0)
  const subBackend = new Canvas2DBackend(sample, project.width, project.height)
  for (let i = 0; i < samples; i++) {
    const sampleMs = start + windowMs * ((i + 0.5) / samples)
    const resolved = resolveAnimatedElement(element, transformWindowMs > 0 ? sampleMs : timeMs)
    const sub = 'blendMode' in resolved && resolved.blendMode ? { ...resolved, blendMode: undefined } : resolved
    sample.clearRect(0, 0, width / renderScale, height / renderScale)
    renderer(sub, createElementContext(subBackend, project, track, timeMs, options.source, sampleMs))
    accumulate.save()
    accumulate.globalCompositeOperation = 'lighter'
    accumulate.globalAlpha = 1 / samples
    accumulate.drawImage(sample.canvas, 0, 0)
    accumulate.restore()
  }

  const ctx = backend.acquireRaster()
  ctx.save()
  const blendMode = 'blendMode' in element ? element.blendMode : undefined
  if (blendMode) ctx.globalCompositeOperation = toCompositeOperation(blendMode)
  ctx.drawImage(accumulate.canvas, 0, 0, project.width, project.height)
  ctx.restore()
  return true
}
