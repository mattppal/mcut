import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { buildFilterString, effectSchema } from './effects'
import { createProject, type Project, type TextElement, type VideoElement } from './model'
import { getElement } from './selectors'
import { getTransitionPair } from './transitions'

function projectWithText(): Project {
  let project = createProject({ name: 'fx' })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { type: 'text', id: 'e-t', text: 'hello', startMs: 0, durationMs: 1000 },
  })
  return project
}

const el = (p: Project, id: string) => getElement(p, id as `e-${string}`)!

describe('buildFilterString', () => {
  test('compiles enabled effects in stack order and skips inert ones', () => {
    const effects = [
      effectSchema.parse({ type: 'blur', radius: 4 }),
      effectSchema.parse({ type: 'brightness', amount: 1 }), // inert at 1
      effectSchema.parse({ type: 'saturate', amount: 1.5, enabled: false }),
      effectSchema.parse({ type: 'hue-rotate', degrees: 45 }),
      effectSchema.parse({ type: 'css', filter: 'url(#custom)' }),
    ]
    expect(buildFilterString(effects)).toBe('blur(4px) hue-rotate(45deg) url(#custom)')
    expect(buildFilterString([])).toBe('')
    expect(buildFilterString(undefined)).toBe('')
  })
})

describe('effect commands', () => {
  test('addEffect / updateEffect / removeEffect / reorderEffect', () => {
    let project = projectWithText()
    project = applyCommand(project, {
      type: 'addEffect',
      elementId: 'e-t',
      effect: { type: 'blur', radius: 10 },
    })
    project = applyCommand(project, {
      type: 'addEffect',
      elementId: 'e-t',
      effect: { type: 'sepia' },
    })
    let text = el(project, 'e-t') as TextElement
    expect(text.effects?.map((e) => e.type)).toEqual(['blur', 'sepia'])

    project = applyCommand(project, {
      type: 'updateEffect',
      elementId: 'e-t',
      index: 0,
      patch: { radius: 20, enabled: false },
    })
    text = el(project, 'e-t') as TextElement
    expect(text.effects?.[0]).toMatchObject({ type: 'blur', radius: 20, enabled: false })

    expect(() =>
      applyCommand(project, {
        type: 'updateEffect',
        elementId: 'e-t',
        index: 0,
        patch: { type: 'sepia' },
      }),
    ).toThrow(CommandError)
    expect(() =>
      applyCommand(project, { type: 'updateEffect', elementId: 'e-t', index: 5, patch: {} }),
    ).toThrow(CommandError)

    project = applyCommand(project, {
      type: 'reorderEffect',
      elementId: 'e-t',
      fromIndex: 1,
      toIndex: 0,
    })
    text = el(project, 'e-t') as TextElement
    expect(text.effects?.map((e) => e.type)).toEqual(['sepia', 'blur'])

    project = applyCommand(project, { type: 'removeEffect', elementId: 'e-t', index: 0 })
    project = applyCommand(project, { type: 'removeEffect', elementId: 'e-t', index: 0 })
    text = el(project, 'e-t') as TextElement
    expect(text.effects).toBeUndefined()
  })

  test('rejects non-visual elements', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-au', kind: 'audio', src: 'blob:audio', durationMs: 5000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'audio', id: 'e-a', assetId: 'a-au', startMs: 0, durationMs: 1000 },
    })
    expect(() =>
      applyCommand(project, { type: 'addEffect', elementId: 'e-a', effect: { type: 'blur' } }),
    ).toThrow(CommandError)
  })

  test('setBlendMode sets and clears', () => {
    let project = projectWithText()
    project = applyCommand(project, { type: 'setBlendMode', elementId: 'e-t', blendMode: 'screen' })
    expect((el(project, 'e-t') as TextElement).blendMode).toBe('screen')
    project = applyCommand(project, { type: 'setBlendMode', elementId: 'e-t', blendMode: null })
    expect((el(project, 'e-t') as TextElement).blendMode).toBeUndefined()
  })
})

describe('transitions', () => {
  function projectWithAdjacentVideos(): Project {
    let project = createProject({ name: 'tx' })
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 20_000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', id: 'e-l', assetId: 'a-vid', startMs: 0, durationMs: 2000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: {
        type: 'video',
        id: 'e-r',
        assetId: 'a-vid',
        startMs: 2000,
        durationMs: 2000,
        trimStartMs: 5000,
      },
    })
    return project
  }

  test('setTransition requires a butt cut and clears with null', () => {
    let project = projectWithAdjacentVideos()
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'dissolve', durationMs: 600 },
    })
    const left = el(project, 'e-l') as VideoElement
    expect(left.transition).toEqual({ type: 'dissolve', durationMs: 600 })

    const pair = getTransitionPair(project.tracks[0]!, left)!
    expect(pair.right.id).toBe('e-r')
    expect(pair.cutMs).toBe(2000)

    // No adjacent neighbor → rejected.
    expect(() =>
      applyCommand(project, {
        type: 'setTransition',
        elementId: 'e-r',
        transition: { type: 'dissolve', durationMs: 600 },
      }),
    ).toThrow(CommandError)

    project = applyCommand(project, { type: 'setTransition', elementId: 'e-l', transition: null })
    expect((el(project, 'e-l') as VideoElement).transition).toBeUndefined()
  })

  test('moving the right clip silently disables the pair (data survives)', () => {
    let project = projectWithAdjacentVideos()
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'wipe-right', durationMs: 400 },
    })
    project = applyCommand(project, { type: 'moveElement', elementId: 'e-r', startMs: 3000 })
    const left = el(project, 'e-l') as VideoElement
    expect(left.transition).toBeDefined()
    expect(getTransitionPair(project.tracks[0]!, left)).toBeNull()
  })

  test('split moves the transition to the right half', () => {
    let project = projectWithAdjacentVideos()
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'dissolve', durationMs: 600 },
    })
    project = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-l',
      atMs: 1000,
      rightElementId: 'e-l2',
    })
    expect((el(project, 'e-l') as VideoElement).transition).toBeUndefined()
    expect((el(project, 'e-l2') as VideoElement).transition).toEqual({
      type: 'dissolve',
      durationMs: 600,
    })
    // The right half still forms a valid pair with the old neighbor.
    const pair = getTransitionPair(project.tracks[0]!, el(project, 'e-l2'))!
    expect(pair.right.id).toBe('e-r')
  })
})
