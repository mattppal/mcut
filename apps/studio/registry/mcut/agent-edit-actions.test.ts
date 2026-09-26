import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject, getElement } from '@mcut/timeline'
import { applyOpeningClosingFades, removeTranscriptSilence, silenceRemovalEnabled } from './agent-edit-actions'

describe('agent edit action inputs', () => {
  test('a wrong-typed field is rejected with the field named', () => {
    const engine = new EditorEngine({ project: createProject() })

    expect(() => removeTranscriptSilence(engine, { paddingMs: '0' })).toThrow('✖ Invalid input: expected number, received string\n  → at paddingMs')
  })

  test("a field outside the action's schema is rejected", () => {
    const engine = new EditorEngine({ project: createProject() })

    expect(() => applyOpeningClosingFades(engine, { durationMs: 500, fadeMs: 1 })).toThrow('✖ Unrecognized key: "fadeMs"')
  })

  test('remove transcript silence cuts a multicam on its offset audio and stays enabled', () => {
    const engine = new EditorEngine({ project: createProject() })
    engine.dispatch({ type: 'addTrack', id: 't-mic' })
    engine.dispatch({ type: 'addTrack', id: 't-captions', name: 'Captions' })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 60000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'blob:mic', durationMs: 60000 } })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 1000, durationMs: 10000, trimStartMs: 0 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-mic',
      element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 1000, durationMs: 10000, trimStartMs: 2000 },
    })
    engine.dispatch({
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }],
      multicamId: 'e-mc',
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-captions',
      element: {
        id: 'e-caption',
        type: 'caption',
        startMs: 1000,
        durationMs: 10000,
        text: 'hello world',
        words: [
          { text: 'hello', startMs: 0, endMs: 3000 },
          { text: 'world', startMs: 7000, endMs: 10000 },
        ],
      },
    })

    expect(silenceRemovalEnabled(new EditorEngine({ project: createProject() }))).toBe(false)
    expect(silenceRemovalEnabled(engine)).toBe(true)
    const result = removeTranscriptSilence(engine, { elementId: 'e-mc', paddingMs: 0, trimEnds: false })
    expect(result).toEqual({
      elementId: 'e-mc',
      applied: 3,
      removedMs: 4000,
      silences: [{ startMs: 5000, endMs: 9000 }],
    })
    const pieces = engine.project.tracks.flatMap((track) => track.elements).filter((element) => element.type === 'multicam')
    expect(pieces[0]).toMatchObject({ id: 'e-mc', startMs: 1000, durationMs: 3000, trimStartMs: 0 })
    expect(pieces[1]).toMatchObject({ startMs: 4000, durationMs: 3000, trimStartMs: 7000 })
  })

  test('a selected multicam with no audio source does not cut the music on another track', () => {
    const engine = multicamBesideMusic(false)
    engine.select(['e-mc'])

    expect(() => removeTranscriptSilence(engine, { paddingMs: 0, trimEnds: false })).toThrow(
      'Element "e-mc" has no audio source. Set one with setMulticamAudio.',
    )
    expect(getElement(engine.project, 'e-music')).toMatchObject({ id: 'e-music', startMs: 0, durationMs: 20000, trimStartMs: 0 })
    const multicams = engine.project.tracks.flatMap((track) => track.elements).filter((element) => element.type === 'multicam')
    expect(multicams).toHaveLength(1)
    expect(multicams[0]).toMatchObject({ id: 'e-mc', startMs: 1000, durationMs: 10000, trimStartMs: 0 })
  })

  test('a selected multicam with an audio source is the silence target, and the music clip stays whole', () => {
    const engine = multicamBesideMusic(true)
    engine.select(['e-mc'])

    const result = removeTranscriptSilence(engine, { paddingMs: 0, trimEnds: false })
    expect(result).toEqual({
      elementId: 'e-mc',
      applied: 3,
      removedMs: 4000,
      silences: [{ startMs: 5000, endMs: 9000 }],
    })
    expect(getElement(engine.project, 'e-music')).toMatchObject({ id: 'e-music', startMs: 0, durationMs: 20000, trimStartMs: 0 })
    const multicams = engine.project.tracks.flatMap((track) => track.elements).filter((element) => element.type === 'multicam')
    expect(multicams[0]).toMatchObject({ id: 'e-mc', startMs: 1000, durationMs: 3000, trimStartMs: 0 })
    expect(multicams[1]).toMatchObject({ startMs: 4000, durationMs: 3000, trimStartMs: 7000 })
  })

  test('with nothing selected, transcript silence still falls back to the music clip', () => {
    const engine = multicamBesideMusic(false)
    engine.select([])

    const result = removeTranscriptSilence(engine, { paddingMs: 0, trimEnds: false })
    expect(result).toEqual({
      elementId: 'e-music',
      applied: 3,
      removedMs: 4000,
      silences: [{ startMs: 4000, endMs: 8000 }],
    })
    expect(getElement(engine.project, 'e-music')).toMatchObject({ startMs: 0, durationMs: 4000, trimStartMs: 0 })
    const pieces = engine.project.tracks.flatMap((track) => track.elements).filter((element) => element.type === 'audio')
    expect(pieces).toHaveLength(2)
    expect(pieces[1]).toMatchObject({ startMs: 4000, durationMs: 12000, trimStartMs: 8000 })
    expect(engine.project.tracks.flatMap((track) => track.elements).filter((element) => element.type === 'multicam')).toHaveLength(1)
  })

  test('an element id without the e- prefix is rejected before any lookup', () => {
    const engine = new EditorEngine({ project: createProject() })

    expect(() => applyOpeningClosingFades(engine, { elementId: 'video' })).toThrow('✖ invalid element id (expected "e-..." prefix)\n  → at elementId')
  })
})

function multicamBesideMusic(withAudio: boolean): EditorEngine {
  const engine = new EditorEngine({ project: createProject() })
  engine.dispatch({ type: 'addTrack', id: 't-mic' })
  engine.dispatch({ type: 'addTrack', id: 't-music' })
  engine.dispatch({ type: 'addTrack', id: 't-captions', name: 'Captions' })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 60000 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'blob:mic', durationMs: 60000 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-music', kind: 'audio', src: 'blob:music', durationMs: 60000 } })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 1000, durationMs: 10000, trimStartMs: 0 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-mic',
    element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 1000, durationMs: 10000, trimStartMs: 2000 },
  })
  engine.dispatch({
    type: 'createMulticam',
    sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }],
    multicamId: 'e-mc',
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-music',
    element: { id: 'e-music', type: 'audio', assetId: 'a-music', startMs: 0, durationMs: 20000, trimStartMs: 0 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-captions',
    element: {
      id: 'e-caption',
      type: 'caption',
      startMs: 1000,
      durationMs: 10000,
      text: 'hello world',
      words: [
        { text: 'hello', startMs: 0, endMs: 3000 },
        { text: 'world', startMs: 7000, endMs: 10000 },
      ],
    },
  })
  if (!withAudio) engine.dispatch({ type: 'setMulticamAudio', elementId: 'e-mc', sourceKey: null })
  return engine
}
