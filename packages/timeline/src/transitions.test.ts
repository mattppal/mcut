import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { createProject, type Project } from './model'
import { getElement, getTrack } from './selectors'
import { getTransitionPair } from './transitions'

const TRACK = 't-default'

function adjacentPair(leftDurationMs = 2000, rightDurationMs = 2000): Project {
  let project = createProject({ fps: 30 })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: TRACK,
    element: { id: 'e-l', type: 'text', text: 'l', startMs: 0, durationMs: leftDurationMs },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: TRACK,
    element: {
      id: 'e-r',
      type: 'text',
      text: 'r',
      startMs: leftDurationMs,
      durationMs: rightDurationMs,
    },
  })
  return project
}

describe('setTransition validation', () => {
  test('requires a butt cut', () => {
    let project = adjacentPair()
    project = applyCommand(project, { type: 'moveElement', elementId: 'e-r', startMs: 3000 })
    expect(() =>
      applyCommand(project, {
        type: 'setTransition',
        elementId: 'e-l',
        transition: { type: 'dissolve', durationMs: 500 },
      }),
    ).toThrow(CommandError)
  })

  test('stores the window clamped to the shorter neighbor', () => {
    const project = applyCommand(adjacentPair(2000, 400), {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'dissolve', durationMs: 1000 },
    })
    const left = getElement(project, 'e-l')!
    expect('transition' in left && left.transition?.durationMs).toBe(400)
  })

  test('keeps the requested window when it fits', () => {
    const project = applyCommand(adjacentPair(), {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'wipe-left', durationMs: 800 },
    })
    const left = getElement(project, 'e-l')!
    expect('transition' in left && left.transition).toEqual({ type: 'wipe-left', durationMs: 800 })
  })

  test('rejects cuts whose clips cannot host a 100ms window', () => {
    expect(() =>
      applyCommand(adjacentPair(2000, 50), {
        type: 'setTransition',
        elementId: 'e-l',
        transition: { type: 'dissolve', durationMs: 500 },
      }),
    ).toThrow(CommandError)
  })

  test('null clears', () => {
    let project = applyCommand(adjacentPair(), {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'dissolve', durationMs: 500 },
    })
    project = applyCommand(project, { type: 'setTransition', elementId: 'e-l', transition: null })
    const left = getElement(project, 'e-l')!
    expect('transition' in left ? left.transition : undefined).toBeUndefined()
  })

  test('moving a clip disables the pair without corrupting the document', () => {
    let project = applyCommand(adjacentPair(), {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'dissolve', durationMs: 500 },
    })
    project = applyCommand(project, { type: 'moveElement', elementId: 'e-r', startMs: 5000 })
    const track = getTrack(project, TRACK)!
    expect(getTransitionPair(track, getElement(project, 'e-l')!)).toBeNull()
  })
})
