import {
  getActiveTransitionPairs,
  getTransitionCompletion,
  isElementActiveAt,
  resolveAnimatedElement,
  type Project,
  type TimelineElement,
  type Track,
  type TransitionPair,
} from '@mcut/timeline'
import { Canvas2DBackend, createElementContext, type RenderBackend } from './backend'
import { renderElementWithMotionBlur } from './motion-blur'
import { renderElementLayer } from './renderers'
import { transitionRenderers, type TransitionRenderContext } from './transition-renderers'
import type { Canvas2D, RenderFrameOptions } from './types'

/**
 * Render one frame of `project` at `timeMs` into `ctx` (canvas2d path).
 *
 * Pure with respect to inputs: the same project, time, and frame source
 * produce the same pixels — which is what makes the export path
 * deterministic. The context is expected to be in project coordinates
 * (`project.width` × `project.height`); callers rendering at other sizes
 * apply their own transform before calling.
 */
export function renderFrame(
  ctx: Canvas2D,
  project: Project,
  timeMs: number,
  options: RenderFrameOptions = {},
): void {
  renderFrameWith(new Canvas2DBackend(ctx, project.width, project.height), project, timeMs, options)
}

/**
 * Render one frame through an explicit {@link RenderBackend}. The
 * track/element walk, transition pairing, and animation resolution here are
 * backend-agnostic; only the draws differ.
 *
 * Tracks render bottom-up (index 0 first), elements in start order. Clips
 * joined by a transition render through the blend instead of the normal
 * pass while the window (centered on their cut) is active.
 */
export function renderFrameWith(
  backend: RenderBackend,
  project: Project,
  timeMs: number,
  options: RenderFrameOptions = {},
): void {
  backend.beginFrame(options.backgroundColor ?? '#000000')

  for (const track of project.tracks) {
    if (track.hidden) continue
    const pairs = getActiveTransitionPairs(track, timeMs)
    const blending = new Set<string>()
    for (const pair of pairs) {
      blending.add(pair.left.id)
      blending.add(pair.right.id)
    }
    for (const element of track.elements) {
      if (element.startMs > timeMs) break // sorted by startMs
      if (options.skipElementIds?.has(element.id)) continue
      if (blending.has(element.id)) continue
      if (!isElementActiveAt(element, timeMs)) continue
      renderElement(backend, project, track, element, timeMs, options)
    }
    for (const pair of pairs) {
      renderTransition(backend, project, track, pair, timeMs, options)
    }
  }
  backend.endFrame()
}

function renderElement(
  backend: RenderBackend,
  project: Project,
  track: Track,
  element: TimelineElement,
  timeMs: number,
  options: RenderFrameOptions,
): void {
  if (
    renderElementWithMotionBlur(backend, project, track, element, timeMs, options, renderElementLayer)
  ) {
    return
  }
  // Keyframed properties resolve here, so preview AND export animate.
  renderElementLayer(
    resolveAnimatedElement(element, timeMs),
    createElementContext(backend, project, track, timeMs, options.source),
  )
}

function renderTransition(
  backend: RenderBackend,
  project: Project,
  track: Track,
  pair: TransitionPair,
  timeMs: number,
  options: RenderFrameOptions,
): void {
  const completion = getTransitionCompletion(pair, timeMs)
  backend.pushRasterScope()
  try {
    const ctx = backend.acquireRaster()
    const context: TransitionRenderContext = {
      ctx,
      project,
      pair,
      timeMs,
      completion,
      drawLeft: () => renderElement(backend, project, track, pair.left, timeMs, options),
      drawRight: () => renderElement(backend, project, track, pair.right, timeMs, options),
    }
    transitionRenderers[pair.type](context)
  } finally {
    backend.popRasterScope()
  }
}
