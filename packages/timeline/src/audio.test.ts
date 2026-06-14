import { describe, expect, test } from 'bun:test'
import { getEffectiveVolume, getFadeGain, hasFades } from './audio'
import { applyCommand } from './commands'
import { createProject, type AudioElement, type Project } from './model'
import { getElement } from './selectors'

describe('getFadeGain', () => {
  test('1 everywhere without fades', () => {
    const el = { durationMs: 2000 }
    expect(getFadeGain(el, 0)).toBe(1)
    expect(getFadeGain(el, 1000)).toBe(1)
    expect(getFadeGain(el, 2000)).toBe(1)
  })

  test('linear fade-in ramp', () => {
    const el = { durationMs: 2000, fadeInMs: 500 }
    expect(getFadeGain(el, 0)).toBe(0)
    expect(getFadeGain(el, 250)).toBeCloseTo(0.5, 5)
    expect(getFadeGain(el, 500)).toBe(1)
    expect(getFadeGain(el, 2000)).toBe(1)
  })

  test('linear fade-out ramp', () => {
    const el = { durationMs: 2000, fadeOutMs: 1000 }
    expect(getFadeGain(el, 1000)).toBe(1)
    expect(getFadeGain(el, 1500)).toBeCloseTo(0.5, 5)
    expect(getFadeGain(el, 2000)).toBe(0)
  })

  test('overlapping fades take the minimum (a dip)', () => {
    const el = { durationMs: 1000, fadeInMs: 1000, fadeOutMs: 1000 }
    expect(getFadeGain(el, 500)).toBeCloseTo(0.5, 5)
    expect(getFadeGain(el, 250)).toBeCloseTo(0.25, 5)
    expect(getFadeGain(el, 900)).toBeCloseTo(0.1, 5)
  })

  test('fades longer than the clip clamp to its duration', () => {
    const el = { durationMs: 1000, fadeInMs: 5000 }
    expect(getFadeGain(el, 500)).toBeCloseTo(0.5, 5)
    expect(getFadeGain(el, 1000)).toBe(1)
  })

  test('out-of-range local times clamp to 0..1', () => {
    const el = { durationMs: 1000, fadeInMs: 200, fadeOutMs: 200 }
    expect(getFadeGain(el, -100)).toBe(0)
    expect(getFadeGain(el, 1100)).toBe(0)
  })

  test('hasFades', () => {
    expect(hasFades({ durationMs: 1000 })).toBe(false)
    expect(hasFades({ durationMs: 1000, fadeInMs: 0 })).toBe(false)
    expect(hasFades({ durationMs: 1000, fadeInMs: 10 })).toBe(true)
    expect(hasFades({ durationMs: 1000, fadeOutMs: 10 })).toBe(true)
  })
})

describe('getEffectiveVolume', () => {
  function projectWithAudio(extra: Record<string, unknown> = {}): Project {
    let project = createProject({ name: 'fades' })
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-aud', kind: 'audio', src: 'blob:audio', durationMs: 10_000 },
    })
    return applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: {
        type: 'audio',
        id: 'e-a',
        assetId: 'a-aud',
        startMs: 1000,
        durationMs: 2000,
        volume: 0.8,
        ...extra,
      },
    })
  }

  test('static volume × fade gain', () => {
    const project = projectWithAudio({ fadeInMs: 500 })
    const element = getElement(project, 'e-a') as AudioElement
    expect(getEffectiveVolume(element, 1000)).toBe(0) // clip start
    expect(getEffectiveVolume(element, 1250)).toBeCloseTo(0.4, 5)
    expect(getEffectiveVolume(element, 2000)).toBeCloseTo(0.8, 5)
  })

  test('keyframed volume × fade gain', () => {
    let project = projectWithAudio({ fadeOutMs: 1000 })
    project = applyCommand(project, {
      type: 'setKeyframe',
      elementId: 'e-a',
      property: 'volume',
      timeMs: 0,
      value: 1,
    })
    const element = getElement(project, 'e-a') as AudioElement
    // Keyframed at 1.0; fade-out halves it at the midpoint of the ramp.
    expect(getEffectiveVolume(element, 2500)).toBeCloseTo(0.5, 5)
  })

  test('0 for elements without volume', () => {
    let project = createProject({ name: 'fades' })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: { type: 'text', id: 'e-t', text: 'hi', startMs: 0, durationMs: 1000 },
    })
    expect(getEffectiveVolume(getElement(project, 'e-t')!, 500)).toBe(0)
  })

  test('fades survive round-trip through the schema', () => {
    const project = projectWithAudio({ fadeInMs: 250, fadeOutMs: 400 })
    const element = getElement(project, 'e-a') as AudioElement
    expect(element.fadeInMs).toBe(250)
    expect(element.fadeOutMs).toBe(400)
  })

  test('split keeps each fade with its edge', () => {
    let project = projectWithAudio({ fadeInMs: 250, fadeOutMs: 400 })
    project = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-a',
      atMs: 2000,
      rightElementId: 'e-right',
    })
    const left = getElement(project, 'e-a') as AudioElement
    const right = getElement(project, 'e-right') as AudioElement
    expect(left.fadeInMs).toBe(250)
    expect(left.fadeOutMs).toBeUndefined()
    expect(right.fadeInMs).toBeUndefined()
    expect(right.fadeOutMs).toBe(400)
  })
})
