import type { Project, TransitionPair, TransitionType } from '@mcut/timeline'
import type { Canvas2D } from './types'

export interface TransitionRenderContext {
  ctx: Canvas2D
  project: Project
  pair: TransitionPair
  timeMs: number
  completion: number
  drawLeft: () => void
  drawRight: () => void
}

export type TransitionRenderer = (context: TransitionRenderContext) => void

const dissolve: TransitionRenderer = ({ ctx, completion, drawLeft, drawRight }) => {
  drawLeft()
  ctx.save()
  ctx.globalAlpha *= completion
  drawRight()
  ctx.restore()
}

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

const slide =
  (direction: 1 | -1): TransitionRenderer =>
  ({ ctx, project, completion, drawLeft, drawRight }) => {
    drawLeft()
    const remaining = (1 - completion) * (1 - completion)
    ctx.save()
    ctx.translate(remaining * project.width * direction, 0)
    drawRight()
    ctx.restore()
  }

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

export const transitionRenderers: { readonly [K in TransitionType]: TransitionRenderer } = {
  dissolve,
  'fade-black': fade('#000000'),
  'fade-white': fade('#ffffff'),
  'slide-left': slide(1),
  'slide-right': slide(-1),
  'wipe-left': wipe(false),
  'wipe-right': wipe(true),
}
