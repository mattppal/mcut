import { describe, expect, test } from 'bun:test'
import { getEffectiveVolume, getFadeGain, hasFades } from './audio'
import { getVoiceSource } from './audio-source'
import { applyCommand } from './commands'
import { EditorEngine } from './engine'
import type { ElementId } from './id'
import { createProject, type AudioElement, type Project, type TimelineElement } from './model'
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
    expect(getEffectiveVolume(element, 1000)).toBe(0)
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

function readVoice(project: Project, id: ElementId) {
  const element = requireElement(project, id)
  if (element.type === 'video' || element.type === 'audio' || element.type === 'multicam') return element.voice
  return undefined
}

function requireElement(project: Project, id: ElementId): TimelineElement {
  const element = getElement(project, id)
  if (!element) throw new Error(`missing ${id}`)
  return element
}

describe('voice', () => {
  test('updateElement stores voice, rejects an amount above 1, undo restores it, and split keeps it', () => {
    const engine = new EditorEngine()
    const track = engine.project.tracks[0]
    if (!track) throw new Error('missing track')
    const trackId = track.id
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 20_000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-aud', kind: 'audio', src: 'blob:audio', durationMs: 20_000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:cam', durationMs: 20_000 } })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'video', id: 'e-vid', assetId: 'a-vid', startMs: 0, durationMs: 4000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'audio', id: 'e-aud', assetId: 'a-aud', startMs: 4000, durationMs: 4000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: {
        type: 'multicam',
        id: 'e-mc',
        startMs: 8000,
        durationMs: 4000,
        sources: [
          { key: 'screen', assetId: 'a-vid' },
          { key: 'camera', assetId: 'a-cam' },
        ],
        angles: [{ atMs: 0, layoutId: 'lay-1' }],
        audioSource: 'camera',
      },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: {
        type: 'multicam',
        id: 'e-quiet',
        startMs: 12_000,
        durationMs: 2000,
        sources: [{ key: 'screen', assetId: 'a-vid' }],
        angles: [{ atMs: 0, layoutId: 'lay-1' }],
      },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-text', text: 'hi', startMs: 14_000, durationMs: 1000 },
    })

    const cases: Array<{ id: ElementId; atMs: number; rightId: ElementId; assetId: 'a-vid' | 'a-aud' | 'a-cam' }> = [
      { id: 'e-vid', atMs: 2000, rightId: 'e-rvid', assetId: 'a-vid' },
      { id: 'e-aud', atMs: 6000, rightId: 'e-raud', assetId: 'a-aud' },
      { id: 'e-mc', atMs: 10_000, rightId: 'e-rmc', assetId: 'a-cam' },
    ]

    for (const item of cases) {
      engine.dispatch({
        type: 'updateElement',
        elementId: item.id,
        patch: { voice: { enabled: true, amount: 0.5 } },
      })
      expect(readVoice(engine.project, item.id)).toEqual({ enabled: true, amount: 0.5 })
      expect(getVoiceSource(engine.project, requireElement(engine.project, item.id))).toEqual({
        assetId: item.assetId,
        amount: 0.5,
      })
      expect(() =>
        engine.dispatch({
          type: 'updateElement',
          elementId: item.id,
          patch: { voice: { enabled: true, amount: 1.5 } },
        }),
      ).toThrow('invalid element')
      expect(readVoice(engine.project, item.id)).toEqual({ enabled: true, amount: 0.5 })
      engine.undo()
      expect(readVoice(engine.project, item.id)).toBeUndefined()
      expect(getVoiceSource(engine.project, requireElement(engine.project, item.id))).toBeNull()

      engine.dispatch({
        type: 'updateElement',
        elementId: item.id,
        patch: { voice: { enabled: true, amount: 0.5 } },
      })
      engine.dispatch({
        type: 'splitElement',
        elementId: item.id,
        atMs: item.atMs,
        rightElementId: item.rightId,
      })
      expect(readVoice(engine.project, item.id)).toEqual({ enabled: true, amount: 0.5 })
      expect(readVoice(engine.project, item.rightId)).toEqual({ enabled: true, amount: 0.5 })
      expect(getVoiceSource(engine.project, requireElement(engine.project, item.rightId))).toEqual({
        assetId: item.assetId,
        amount: 0.5,
      })
    }

    engine.dispatch({
      type: 'updateElement',
      elementId: 'e-vid',
      patch: { voice: { enabled: true, amount: 0 } },
    })
    expect(getVoiceSource(engine.project, requireElement(engine.project, 'e-vid'))).toBeNull()
    engine.dispatch({
      type: 'updateElement',
      elementId: 'e-vid',
      patch: { voice: { enabled: false, amount: 0.5 } },
    })
    expect(readVoice(engine.project, 'e-vid')).toEqual({ enabled: false, amount: 0.5 })
    expect(getVoiceSource(engine.project, requireElement(engine.project, 'e-vid'))).toBeNull()
    expect(getVoiceSource({ ...engine.project, assets: {} }, requireElement(engine.project, 'e-mc'))).toBeNull()

    engine.dispatch({
      type: 'updateElement',
      elementId: 'e-quiet',
      patch: { voice: { enabled: true, amount: 1 } },
    })
    expect(getVoiceSource(engine.project, requireElement(engine.project, 'e-quiet'))).toBeNull()
    expect(getVoiceSource(engine.project, requireElement(engine.project, 'e-text'))).toBeNull()
  })
})
