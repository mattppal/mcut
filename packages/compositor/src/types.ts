import type { AssetId, Project, TimelineElement, Track } from '@mcut/timeline'

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface FrameSource {
  getFrame(assetId: AssetId, sourceTimeMs: number): CanvasImageSource | null
}

export interface RenderFrameOptions {
  source?: FrameSource
  backgroundColor?: string
  skipElementIds?: ReadonlySet<string>
  motionBlurSamples?: number
  renderScale?: number
  createScratchContext?: (width: number, height: number) => Canvas2D | null
}

export interface ElementRenderContext {
  ctx: Canvas2D
  backend: import('./backend').RenderBackend
  project: Project
  track: Track
  timeMs: number
  viewTimeMs: number
  viewport: { x: number; y: number; w: number; h: number } | null
  source: FrameSource | undefined
  acquireScratch: (width: number, height: number) => Canvas2D | null
}

export type ElementRenderer<E extends TimelineElement = TimelineElement> = (element: E, context: ElementRenderContext) => void
