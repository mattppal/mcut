import type { Project, TransitionPair } from '@mcut/timeline'
import type { Canvas2D } from './types'

/**
 * The renderer half of the transition registry (pair it with
 * registerTransitionType in @mcut/timeline). A transition is a pure mixer:
 * given draw thunks for both sides of a cut and the blend completion, paint
 * the in-between frame. The same renderers serve clip-to-clip transitions
 * (render-frame.ts) and multicam angle-cut transitions (renderers.ts).
 */

/** Everything a transition renderer needs to blend its pair. */
export interface TransitionRenderContext {
  ctx: Canvas2D
  project: Project
  pair: TransitionPair
  timeMs: number
  /** Blend completion 0→1 across the window (0.5 at the cut). */
  completion: number
  /** Draw the outgoing clip (already extended past its out point). */
  drawLeft: () => void
  /** Draw the incoming clip (already pre-rolling before its in point). */
  drawRight: () => void
}

export type TransitionRenderer = (context: TransitionRenderContext) => void

const transitionRenderers = new Map<string, TransitionRenderer>()

/**
 * Register the renderer half of a transition type. Built-ins register below
 * through the same call; re-registering overrides (e.g. to restyle a
 * built-in wipe).
 */
export function registerTransitionRenderer(type: string, renderer: TransitionRenderer): void {
  transitionRenderers.set(type, renderer)
}

/** The registered renderer for `type`, or undefined (degrade to a hard cut). */
export function getTransitionRenderer(type: string): TransitionRenderer | undefined {
  return transitionRenderers.get(type)
}

// ---------------------------------------------------------------------------
// Built-in transitions (~Diffusion Studio's playbook: dissolve = alpha,
// fades = a veil peaking at the cut, slides = eased translate, wipes = a
// growing clip rect), registered through the same API custom ones use.
// ---------------------------------------------------------------------------

registerTransitionRenderer('dissolve', ({ ctx, completion, drawLeft, drawRight }) => {
  drawLeft()
  ctx.save()
  ctx.globalAlpha *= completion
  drawRight()
  ctx.restore()
})

const fade =
  (color: string): TransitionRenderer =>
  ({ ctx, project, pair, timeMs, completion, drawLeft, drawRight }) => {
    if (timeMs < pair.cutMs) drawLeft()
    else drawRight()
    const veil = completion < 0.5 ? completion * 2 : (1 - completion) * 2
    if (veil > 0) {
      ctx.save()
      ctx.globalAlpha *= veil
      ctx.fillStyle = color
      ctx.fillRect(0, 0, project.width, project.height)
      ctx.restore()
    }
  }
registerTransitionRenderer('fade-black', fade('#000000'))
registerTransitionRenderer('fade-white', fade('#ffffff'))

const slide =
  (direction: 1 | -1): TransitionRenderer =>
  ({ ctx, project, completion, drawLeft, drawRight }) => {
    drawLeft()
    // Ease-out square: fast entry settling into place.
    const remaining = (1 - completion) * (1 - completion)
    ctx.save()
    ctx.translate(remaining * project.width * direction, 0)
    drawRight()
    ctx.restore()
  }
registerTransitionRenderer('slide-left', slide(1))
registerTransitionRenderer('slide-right', slide(-1))

const wipe =
  (fromLeft: boolean): TransitionRenderer =>
  ({ ctx, project, completion, drawLeft, drawRight }) => {
    drawLeft()
    const revealed = project.width * completion
    ctx.save()
    ctx.beginPath()
    if (fromLeft) ctx.rect(0, 0, revealed, project.height)
    else ctx.rect(project.width - revealed, 0, revealed, project.height)
    ctx.clip()
    drawRight()
    ctx.restore()
  }
registerTransitionRenderer('wipe-right', wipe(true))
registerTransitionRenderer('wipe-left', wipe(false))
