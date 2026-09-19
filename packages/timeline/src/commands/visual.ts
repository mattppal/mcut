import { z } from 'zod'
import { blendModeSchema, effectSchema, motionBlurSchema, type Effect } from '../effects'
import { CommandError } from '../errors'
import type { ElementId } from '../id'
import { elementIdSchema, type Project, type TimelineElement } from '../model'
import { getTransitionPair, MIN_TRANSITION_DURATION_MS, transitionSchema } from '../transitions'
import { defineCommand, mustLocate, replaceTrack } from './shared'

type VisualElement = TimelineElement & { type: 'video' | 'image' | 'text' | 'multicam' }

function mustBeVisual(element: TimelineElement): asserts element is VisualElement {
  if (
    element.type !== 'video' &&
    element.type !== 'image' &&
    element.type !== 'text' &&
    element.type !== 'multicam'
  ) {
    throw new CommandError(
      'invalid-payload',
      `"${element.type}" elements have no effects/blending/transitions`,
    )
  }
}

function withVisualElement(
  project: Project,
  elementId: ElementId,
  update: (element: VisualElement) => TimelineElement,
): Project {
  const { track, element } = mustLocate(project, elementId)
  mustBeVisual(element)
  const next = update(element)
  return replaceTrack(project, track.id, (t) => ({
    ...t,
    elements: t.elements.map((e) => (e.id === element.id ? next : e)),
  }))
}

function mustGetEffects(element: VisualElement, index: number): Effect[] {
  const effects = element.effects ?? []
  if (index < 0 || index >= effects.length) {
    throw new CommandError('unknown-effect', `element "${element.id}" has no effect at index ${index}`)
  }
  return [...effects]
}

export const addEffect = defineCommand({
  type: 'addEffect',
  description:
    'Append a visual effect to an element\'s effect stack (or insert at `index`). ' +
    'Effects compile to a canvas filter and apply in stack order. Types: blur, ' +
    'brightness, contrast, saturate, grayscale, sepia, hue-rotate, invert, ' +
    'drop-shadow, css (raw CSS filter escape hatch).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    effect: effectSchema,
    index: z.number().int().nonnegative().optional(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = [...(element.effects ?? [])]
      const index = Math.min(payload.index ?? effects.length, effects.length)
      effects.splice(index, 0, payload.effect)
      return { ...element, effects }
    }),
})

export const updateEffect = defineCommand({
  type: 'updateEffect',
  description:
    'Patch the parameters of the effect at `index` in an element\'s stack ' +
    '(e.g. { radius: 12 } or { enabled: false }). The effect\'s `type` cannot change.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    index: z.number().int().nonnegative(),
    patch: z.record(z.string(), z.unknown()),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = mustGetEffects(element, payload.index)
      if ('type' in payload.patch && payload.patch.type !== effects[payload.index]!.type) {
        throw new CommandError('invalid-payload', 'patch may not change the effect "type"')
      }
      const merged = effectSchema.safeParse({ ...effects[payload.index], ...payload.patch })
      if (!merged.success) {
        throw new CommandError(
          'invalid-payload',
          `patch produces an invalid effect: ${merged.error.message}`,
          { cause: merged.error },
        )
      }
      effects[payload.index] = merged.data
      return { ...element, effects }
    }),
})

export const removeEffect = defineCommand({
  type: 'removeEffect',
  description: 'Remove the effect at `index` from an element\'s effect stack.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    index: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = mustGetEffects(element, payload.index)
      effects.splice(payload.index, 1)
      const next: VisualElement = { ...element }
      if (effects.length === 0) delete next.effects
      else next.effects = effects
      return next
    }),
})

export const reorderEffect = defineCommand({
  type: 'reorderEffect',
  description: 'Move an effect within an element\'s stack (stack order = apply order).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    fromIndex: z.number().int().nonnegative(),
    toIndex: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = mustGetEffects(element, payload.fromIndex)
      const toIndex = Math.min(payload.toIndex, effects.length - 1)
      const [effect] = effects.splice(payload.fromIndex, 1)
      effects.splice(toIndex, 0, effect!)
      return { ...element, effects }
    }),
})

export const setBlendMode = defineCommand({
  type: 'setBlendMode',
  description:
    'Set how a visual element composites against the layers below ' +
    '(multiply, screen, overlay, ...). Pass null for normal.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    blendMode: blendModeSchema.nullable(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.blendMode === null || payload.blendMode === 'normal') delete next.blendMode
      else next.blendMode = payload.blendMode
      return next
    }),
})

export const setMotionBlur = defineCommand({
  type: 'setMotionBlur',
  description:
    'Set per-element motion blur (After Effects layer model: sub-frame ' +
    'transform samples accumulated across a shutter window). Only KEYFRAMED ' +
    'position/scale/rotation motion blurs. shutterAngle 360 = full frame ' +
    'interval; 180 = film look (default). Pass null to turn it off.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    motionBlur: motionBlurSchema.nullable(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.motionBlur === null) delete next.motionBlur
      else next.motionBlur = payload.motionBlur
      return next
    }),
})

export const setTransition = defineCommand({
  type: 'setTransition',
  description:
    'Set (or clear with null) the transition from an element into the NEXT ' +
    'exactly-adjacent clip on the same track. Types: dissolve, fade-black, ' +
    'fade-white, slide-left, slide-right, wipe-left, wipe-right. The blend ' +
    'window is centered on the cut and never longer than either clip; where ' +
    'a clip has no media handles the renderer freezes its boundary frame.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    transition: transitionSchema.nullable(),
  }),
  reduce: (project, payload) => {
    const { track } = mustLocate(project, payload.elementId)
    return withVisualElement(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.transition === null) {
        delete next.transition
        return next
      }
      next.transition = payload.transition
      const pair = getTransitionPair(track, next)
      if (!pair) {
        throw new CommandError(
          'invalid-payload',
          `element "${element.id}" has no exactly-adjacent next clip on its track ` +
            '(transitions require a butt cut)',
        )
      }
      if (pair.durationMs < MIN_TRANSITION_DURATION_MS) {
        throw new CommandError(
          'out-of-bounds',
          `clips at this cut are too short for a transition (max window ${pair.durationMs}ms)`,
        )
      }
      next.transition = { ...payload.transition, durationMs: pair.durationMs }
      return next
    })
  },
})
