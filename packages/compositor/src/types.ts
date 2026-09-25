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
  createScratchContext?: (width: number, height: number) => Canvas2D | null
}

export interface ElementRenderContext {
  ctx: Canvas2D
  backend: import('./backend').RenderBackend
  project: Project
  track: Track
  timeMs: number
  viewTimeMs: number
  source: FrameSource | undefined
  acquireScratch: (width: number, height: number) => Canvas2D | null
}

export type ElementRenderer<E extends TimelineElement = TimelineElement> = (element: E, context: ElementRenderContext) => void
