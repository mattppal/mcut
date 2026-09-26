import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject, getElement, getElementLocation } from '@mcut/timeline'
import { OperatorError } from './operators'

function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}
import { planSilenceCuts, type SilenceCutTranscript } from './silence-cuts'

function projectWithClip(options: { startMs?: number; durationMs?: number; trimStartMs?: number } = {}) {
  const engine = new EditorEngine({ project: createProject({ id: 'p-test' }) })
  engine.dispatch({
    type: 'addAsset',
    asset: { id: 'a-1', kind: 'video', src: 'media/a.mp4', name: 'a.mp4', durationMs: 60000 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-1',
      type: 'video',
      startMs: options.startMs ?? 0,
      durationMs: options.durationMs ?? 10000,
      trimStartMs: options.trimStartMs ?? 0,
      assetId: 'a-1',
    },
  })
  return engine.project
}

function transcript(words: Array<[number, number]>): SilenceCutTranscript {
  return {
    words: words.map(([startMs, endMs]) => ({ startMs, endMs })),
  }
}

describe('planSilenceCuts', () => {
  test('cuts an interior gap with padding and ripples later content left', () => {
    const project = projectWithClip()
    const plan = planSilenceCuts(
      project,
      'e-1',
      transcript([
        [0, 3000],
        [7000, 10000],
      ]),
      {
        minGapMs: 600,
        paddingMs: 120,
      },
    )
    expect(plan.silences).toEqual([{ startMs: 3120, endMs: 6880 }])
    expect(plan.removedMs).toBe(3760)
    const track = plan.project.tracks[0]!
    expect(track.elements).toHaveLength(2)
    expect(track.elements[0]).toMatchObject({ id: 'e-1', startMs: 0, durationMs: 3120 })
    expect(track.elements[1]).toMatchObject({ startMs: 3120, trimStartMs: 6880 })
    expect(track.elements[1]!.durationMs).toBe(3120)
  })

  test('cuts leading and trailing silence with no gap left behind', () => {
    const project = projectWithClip()
    const plan = planSilenceCuts(project, 'e-1', transcript([[2000, 8000]]), {
      minGapMs: 600,
      paddingMs: 100,
    })
    expect(plan.silences).toEqual([
      { startMs: 0, endMs: 1900 },
      { startMs: 8100, endMs: 10000 },
    ])
    expect(getElementLocation(plan.project, 'e-1')).toBeUndefined()
    const elements = plan.project.tracks[0]!.elements
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({ startMs: 0, trimStartMs: 1900, durationMs: 6200 })
  })

  test('respects trimStartMs offsets because transcript times are source time', () => {
    const project = projectWithClip({ startMs: 1000, trimStartMs: 5000, durationMs: 10000 })
    const plan = planSilenceCuts(
      project,
      'e-1',
      transcript([
        [5000, 9000],
        [12000, 15000],
      ]),
      {
        paddingMs: 0,
        trimEnds: false,
      },
    )
    expect(plan.silences).toEqual([{ startMs: 9000, endMs: 12000 }])
    const track = plan.project.tracks[0]!
    expect(track.elements[0]).toMatchObject({ id: 'e-1', startMs: 1000, durationMs: 4000 })
    expect(track.elements[1]).toMatchObject({ startMs: 5000, trimStartMs: 12000, durationMs: 3000 })
  })

  test('merges cuts separated by too-short speech', () => {
    const project = projectWithClip()
    const plan = planSilenceCuts(
      project,
      'e-1',
      transcript([
        [0, 2000],
        [4000, 4100],
        [6000, 10000],
      ]),
      { paddingMs: 0, minKeepMs: 250 },
    )
    expect(plan.silences).toEqual([{ startMs: 2000, endMs: 6000 }])
  })

  test('multiple interior cuts keep earlier timeline positions valid', () => {
    const project = projectWithClip({ durationMs: 12000 })
    const plan = planSilenceCuts(
      project,
      'e-1',
      transcript([
        [0, 2000],
        [4000, 6000],
        [8000, 12000],
      ]),
      { paddingMs: 0 },
    )
    expect(plan.silences).toHaveLength(2)
    const track = plan.project.tracks[0]!
    expect(track.elements).toHaveLength(3)
    const total = track.elements.reduce((sum, e) => sum + e.durationMs, 0)
    expect(total).toBe(12000 - plan.removedMs)
    for (let i = 1; i < track.elements.length; i++) {
      const prev = track.elements[i - 1]!
      expect(track.elements[i]!.startMs).toBe(prev.startMs + prev.durationMs)
    }
  })

  test('refuses elements with a time remap', () => {
    const engine = new EditorEngine({ project: projectWithClip() })
    engine.dispatch({ type: 'setElementSpeed', elementId: 'e-1', speed: 2 })
    const thrown = thrownBy(() => planSilenceCuts(engine.project, 'e-1', transcript([[0, 1000]]), {}))
    expect(thrown).toBeInstanceOf(OperatorError)
    expect(thrown).toMatchObject({ code: 'unsupported', message: expect.stringMatching(/time remap/) })
  })

  test('refuses when the transcript has no words in the window', () => {
    const thrown = thrownBy(() => planSilenceCuts(projectWithClip(), 'e-1', transcript([[20000, 21000]]), {}))
    expect(thrown).toBeInstanceOf(OperatorError)
    expect(thrown).toMatchObject({ code: 'invalid-payload', message: expect.stringMatching(/no words/) })
  })

  test('refuses a reversed clip', () => {
    const engine = new EditorEngine({ project: projectWithClip() })
    engine.dispatch({ type: 'updateElement', elementId: 'e-1', patch: { reversed: true } })
    const thrown = thrownBy(() => planSilenceCuts(engine.project, 'e-1', transcript([[0, 1000]]), {}))
    expect(thrown).toBeInstanceOf(OperatorError)
    expect(thrown).toMatchObject({ code: 'unsupported', message: expect.stringMatching(/reversed/) })
  })

  test('cuts a muted multicam on its offset audio source and keeps each angle cut', () => {
    const engine = new EditorEngine({ project: createProject({ id: 'p-mc' }) })
    engine.dispatch({ type: 'addTrack', id: 't-mic' })
    engine.dispatch({
      type: 'addAsset',
      asset: { id: 'a-screen', kind: 'video', src: 'media/screen.mp4', durationMs: 60000 },
    })
    engine.dispatch({
      type: 'addAsset',
      asset: { id: 'a-mic', kind: 'audio', src: 'media/mic.wav', durationMs: 60000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 1000, durationMs: 20000, trimStartMs: 0 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-mic',
      element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 1000, durationMs: 20000, trimStartMs: 1800 },
    })
    engine.dispatch({
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }],
      multicamId: 'e-mc',
    })
    const camera = engine.project.layouts.find((layout) => layout.name === 'Camera')
    if (!camera) throw new Error('missing camera layout')
    engine.dispatch({ type: 'addAngleCut', elementId: 'e-mc', atMs: 5000, layoutId: camera.id })
    engine.dispatch({ type: 'updateElement', elementId: 'e-mc', patch: { muted: true, volume: 0 } })
    const before = getElement(engine.project, 'e-mc')
    if (before?.type !== 'multicam') throw new Error('missing multicam')
    const angles = before.angles.map((angle) => ({ atMs: angle.atMs, layoutId: angle.layoutId }))

    const plan = planSilenceCuts(
      engine.project,
      'e-mc',
      transcript([
        [1800, 4800],
        [10800, 15800],
      ]),
      { paddingMs: 0, trimEnds: false },
    )

    expect(plan.silences).toEqual([{ startMs: 4800, endMs: 10800 }])
    expect(plan.removedMs).toBe(6000)
    const pieces = plan.project.tracks.flatMap((track) => track.elements).filter((element) => element.type === 'multicam')
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toMatchObject({ id: 'e-mc', startMs: 1000, durationMs: 3000, trimStartMs: 0, angles })
    expect(pieces[1]).toMatchObject({ startMs: 4000, durationMs: 11000, trimStartMs: 9000, angles })
  })

  test('a multicam with no audio source points at setMulticamAudio', () => {
    const engine = new EditorEngine({ project: createProject({ id: 'p-silent' }) })
    engine.dispatch({
      type: 'addAsset',
      asset: { id: 'a-screen', kind: 'video', src: 'media/screen.mp4', durationMs: 60000 },
    })
    engine.dispatch({
      type: 'addAsset',
      asset: { id: 'a-cam', kind: 'video', src: 'media/cam.mp4', durationMs: 60000 },
    })
    engine.dispatch({ type: 'addTrack', id: 't-cam' })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 8000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-cam',
      element: { id: 'e-cam', type: 'video', assetId: 'a-cam', startMs: 0, durationMs: 8000 },
    })
    engine.dispatch({
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }],
      multicamId: 'e-mc',
    })
    engine.dispatch({ type: 'setMulticamAudio', elementId: 'e-mc', sourceKey: null })

    const thrown = thrownBy(() => planSilenceCuts(engine.project, 'e-mc', transcript([[0, 1000]]), {}))
    expect(thrown).toBeInstanceOf(OperatorError)
    expect(thrown).toMatchObject({ code: 'invalid-payload', message: 'element "e-mc" has no audio source; set one with setMulticamAudio' })
  })
})
