import type { Canvas2D, RenderFrameOptions } from './types'

type ScratchRole = 'compose' | 'sample' | 'accumulate'

type ScratchSettings = CanvasRenderingContext2DSettings & { colorType: 'unorm8' | 'float16' }

const SCRATCH_SETTINGS: Record<ScratchRole, ScratchSettings> = {
  compose: { colorType: 'unorm8' },
  sample: { colorType: 'unorm8' },
  accumulate: { colorType: 'float16' },
}

const cachedScratch = new Map<ScratchRole, OffscreenCanvasRenderingContext2D>()

export function acquireScratch(role: ScratchRole, width: number, height: number, options: RenderFrameOptions): Canvas2D | null {
  if (options.createScratchContext) return options.createScratchContext(width, height)
  if (typeof OffscreenCanvas === 'undefined') return null
  const cached = cachedScratch.get(role)
  if (cached && cached.canvas.width === width && cached.canvas.height === height) return cached
  const ctx = new OffscreenCanvas(width, height).getContext('2d', SCRATCH_SETTINGS[role])
  if (!ctx) return null
  cachedScratch.set(role, ctx)
  return ctx
}
