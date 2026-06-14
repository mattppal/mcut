import type { AssetId, Project, TimelineElement, Track } from '@mcut/timeline'

/** A 2D context we can composite into (on- or off-screen). */
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Supplies pixel data for media assets at a given source time. The preview
 * implementation is allowed to be approximate (pooled `<video>` elements);
 * the export implementation must be exact (decoded samples). Keeping this
 * behind an interface is what lets one compositor serve both.
 */
export interface FrameSource {
  /**
   * Image for `assetId` at `sourceTimeMs` (media-local time, after trim).
   * Return `null` when no frame is available yet; the compositor skips it.
   */
  getFrame(assetId: AssetId, sourceTimeMs: number): CanvasImageSource | null
}

export interface RenderFrameOptions {
  /** Pixel source for video/image assets. Omit to render only vector elements. */
  source?: FrameSource
  /** Canvas background. Default black. */
  backgroundColor?: string
  /**
   * Elements to leave out of the frame — e.g. a text element while a DOM
   * inline editor is overlaid on it (the editor IS its WYSIWYG render).
   */
  skipElementIds?: ReadonlySet<string>
  /**
   * Sub-frame passes for per-element motion blur (see `motion-blur.ts`).
   * Default 8; export passes 16.
   */
  motionBlurSamples?: number
  /**
   * Scratch surface factory for motion-blur accumulation; the context is
   * cleared before each use. Defaults to a cached `OffscreenCanvas` —
   * environments without one (and tests) inject this. Return null to
   * disable motion blur.
   */
  createScratchContext?: (width: number, height: number) => Canvas2D | null
}

export interface ElementRenderContext {
  /**
   * Frame-space canvas2d context for raster drawing (text, chrome, custom
   * renderers). On the canvas2d backend this is the target itself; on GPU
   * backends it is a scratch surface composited in z-order. Reading it marks
   * the raster surface in use — renderers with a structured fast path (video
   * /image quads) should draw via `backend` instead.
   */
  ctx: Canvas2D
  /** The draw layer (see backend.ts) — structured fast paths live here. */
  backend: import('./backend').RenderBackend
  project: Project
  track: Track
  /** Absolute timeline time being rendered. */
  timeMs: number
  source: FrameSource | undefined
}

export type ElementRenderer<E extends TimelineElement = TimelineElement> = (
  element: E,
  context: ElementRenderContext,
) => void
