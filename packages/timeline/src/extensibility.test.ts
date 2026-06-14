import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { applyCommand, CommandError } from './commands'
import { buildFilterString, effectSchema, listEffectTypes, registerEffectType } from './effects'
import { animatableProperties, getKeyframes } from './keyframes'
import {
  createProject,
  elementSchema,
  parseProject,
  registerTimelineElementType,
  transformSchema,
  type Project,
  type TimelineElement,
} from './model'
import { getElement } from './selectors'
import { summarizeProject } from './summarize'
import { listTransitionTypes, registerTransitionType } from './transitions'

/**
 * The extensibility contract: custom element types, effects, and transitions
 * registered through the SAME APIs the built-ins use become full citizens —
 * they parse in saved projects, dispatch through commands, keyframe, split,
 * and describe themselves to agents.
 */

// --- a custom element type: an emoji sticker --------------------------------
registerTimelineElementType({
  type: 'sticker',
  shape: {
    emoji: z.string().min(1),
    transform: transformSchema,
    opacity: z.number().min(0).max(1).default(1),
  },
  keyframeable: ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation', 'opacity'],
  describe: (raw) => `sticker ${(raw as { emoji: string }).emoji}`,
  validate: (_project, raw) => {
    if ((raw as { emoji: string }).emoji.length > 8) {
      throw new CommandError('invalid-payload', 'sticker emoji too long')
    }
  },
})

registerEffectType({
  type: 'vignette',
  shape: { strength: z.number().min(0).max(1).default(0.5) },
  // Stand-in compile (a real one would use an SVG filter url()).
  toFilter: (e) => `brightness(${1 - (e.strength as number) * 0.3})`,
  param: { key: 'strength', min: 0, max: 1 },
})

registerTransitionType({ type: 'star-wipe' })

function projectWithSticker(): Project {
  let project = createProject()
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { type: 'sticker', id: 'e-s', emoji: '🔥', startMs: 0, durationMs: 2000 },
  })
  return project
}

describe('custom element types', () => {
  test('dispatch, parse round-trip, and agent summary', () => {
    const project = projectWithSticker()
    const sticker = getElement(project, 'e-s' as `e-${string}`)!
    expect(sticker.type as string).toBe('sticker')

    // Saved-project round trip through the dynamic schema.
    const restored = parseProject(JSON.parse(JSON.stringify(project)))
    expect(getElement(restored, 'e-s' as `e-${string}`)).toEqual(sticker)

    // Agents see the type's own description.
    expect(summarizeProject(project)).toContain('sticker 🔥')
  })

  test('custom validate hook rejects bad elements', () => {
    const project = createProject()
    expect(() =>
      applyCommand(project, {
        type: 'addElement',
        trackId: project.tracks[0]!.id,
        element: { type: 'sticker', emoji: '🔥🔥🔥🔥🔥', startMs: 0, durationMs: 1000 },
      }),
    ).toThrow(CommandError)
  })

  test('keyframes and split work through the generic machinery', () => {
    let project = projectWithSticker()
    const sticker = getElement(project, 'e-s' as `e-${string}`)!
    expect(animatableProperties(sticker)).toContain('position.x')

    project = applyCommand(project, {
      type: 'setKeyframe',
      elementId: 'e-s',
      property: 'opacity',
      timeMs: 0,
      value: 0,
    })
    project = applyCommand(project, {
      type: 'setKeyframe',
      elementId: 'e-s',
      property: 'opacity',
      timeMs: 1000,
      value: 1,
    })
    project = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-s',
      atMs: 500,
      rightElementId: 'e-s2',
    })
    const right = getElement(project, 'e-s2' as `e-${string}`)!
    expect(right.type as string).toBe('sticker')
    // Keyframe continuity across the cut came for free.
    expect(getKeyframes(right, 'opacity')[0]).toMatchObject({ timeMs: 0, value: 0.5 })
  })

  test('unknown element types still fail clearly', () => {
    expect(elementSchema.safeParse({ type: 'hologram', id: 'e-x', startMs: 0, durationMs: 100 }).success).toBe(false)
  })
})

describe('custom effects', () => {
  test('parse, compile, and surface in the picker list', () => {
    const effect = effectSchema.parse({ type: 'vignette', strength: 0.8 })
    expect(effect).toMatchObject({ type: 'vignette', enabled: true, strength: 0.8 })
    expect(buildFilterString([effect])).toBe('brightness(0.76)')
    expect(listEffectTypes().map((e) => e.type)).toContain('vignette')
  })

  test('addEffect command accepts the custom type', () => {
    let project = createProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: { type: 'text', id: 'e-t', text: 'hi', startMs: 0, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'addEffect',
      elementId: 'e-t',
      effect: { type: 'vignette', strength: 0.4 },
    })
    const text = getElement(project, 'e-t' as `e-${string}`) as TimelineElement & { type: 'text' }
    expect(text.effects?.[0]).toMatchObject({ type: 'vignette', strength: 0.4 })
  })
})

describe('custom transitions', () => {
  test('setTransition accepts a registered custom type', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-a', text: 'a', startMs: 0, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-b', text: 'b', startMs: 1000, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-a',
      transition: { type: 'star-wipe', durationMs: 400 },
    })
    const left = getElement(project, 'e-a' as `e-${string}`) as TimelineElement & { type: 'text' }
    expect(left.transition).toEqual({ type: 'star-wipe', durationMs: 400 })
    expect(listTransitionTypes()).toContain('star-wipe')

    // Unregistered types are rejected at the schema.
    expect(() =>
      applyCommand(project, {
        type: 'setTransition',
        elementId: 'e-b',
        transition: { type: 'heart-iris', durationMs: 400 },
      }),
    ).toThrow(CommandError)
  })
})
