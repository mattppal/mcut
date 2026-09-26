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
import type { Canvas2D, ElementRenderContext, RenderFrameOptions } from './types'

export function renderFrame(ctx: Canvas2D, project: Project, timeMs: number, options: RenderFrameOptions = {}): void {
  renderFrameWith(new Canvas2DBackend(ctx, project.width, project.height), project, timeMs, options)
}

export function renderFrameWith(backend: RenderBackend, project: Project, timeMs: number, options: RenderFrameOptions = {}): void {
  backend.beginFrame(options.backgroundColor ?? '#000000')
  const frame = { x: 0, y: 0, w: project.width, h: project.height }

  for (const track of project.tracks) {
    if (track.hidden) continue
    const pairs = getActiveTransitionPairs(track, timeMs)
    const blending = new Set<string>()
    for (const pair of pairs) {
      blending.add(pair.left.id)
      blending.add(pair.right.id)
    }
    for (const element of track.elements) {
      if (element.startMs > timeMs) break
      if (options.skipElementIds?.has(element.id)) continue
      if (blending.has(element.id)) continue
      if (!isElementActiveAt(element, timeMs)) continue
      renderElement(backend, project, track, element, timeMs, options, frame)
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
  viewport: ElementRenderContext['viewport'],
): void {
  if (renderElementWithMotionBlur(backend, project, track, element, timeMs, options, renderElementLayer)) {
    return
  }
  renderElementLayer(resolveAnimatedElement(element, timeMs), createElementContext(backend, project, track, timeMs, options, timeMs, viewport))
}

function renderTransition(backend: RenderBackend, project: Project, track: Track, pair: TransitionPair, timeMs: number, options: RenderFrameOptions): void {
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
      drawLeft: () => renderElement(backend, project, track, pair.left, timeMs, options, null),
      drawRight: () => renderElement(backend, project, track, pair.right, timeMs, options, null),
    }
    transitionRenderers[pair.type](context)
  } finally {
    backend.popRasterScope()
  }
}
