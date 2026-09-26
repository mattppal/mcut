import { describe, expect, test } from 'bun:test'
import { EditorEngine, getElement, type ElementId } from '@mcut/timeline'
import { OperatorError, listOperators, parseOperatorId, runOperator } from './index'

function voiceOf(engine: EditorEngine, id: ElementId) {
  const element = getElement(engine.project, id)
  if (!element) throw new Error(`missing ${id}`)
  if (element.type === 'video' || element.type === 'audio' || element.type === 'multicam') return element.voice
  throw new Error(`${id} is ${element.type}`)
}

describe('editor operators', () => {
  test('runs a user-level text insertion operator', async () => {
    const engine = new EditorEngine()

    const result = await runOperator('edit.addTextAtPlayhead', { engine }, { text: 'Hello' })

    expect(result).toEqual({ elementId: expect.stringMatching(/^e-/) })
    expect(engine.project.tracks).toHaveLength(1)
    const elementId = engine.selection.elementIds[0]
    const element = elementId ? getElement(engine.project, elementId) : null
    expect(element?.type).toBe('text')
    expect(element && 'text' in element ? element.text : null).toBe('Hello')
  })

  test('reports disabled operators before running them', async () => {
    const engine = new EditorEngine()

    const listed = listOperators({ engine }).find((operator) => operator.id === 'edit.deleteSelection')
    expect(listed?.enabled).toBe(false)
    await expect(runOperator('edit.deleteSelection', { engine })).rejects.toThrow(OperatorError)
  })

  test('parses operator ids at the boundary', () => {
    expect(parseOperatorId('playback.toggle')).toBe('playback.toggle')
    expect(() => parseOperatorId('playback.togle')).toThrow('unknown operator "playback.togle"')
  })

  test('moves aggregate keyframes through a semantic keyframe operator', async () => {
    const engine = new EditorEngine()
    const result = (await runOperator('edit.addTextAtPlayhead', { engine }, { text: 'Title' })) as {
      elementId: `e-${string}`
    }

    engine.dispatch({
      type: 'setKeyframe',
      elementId: result.elementId,
      property: 'opacity',
      timeMs: 500,
      value: 0.2,
    })

    await runOperator(
      'keyframes.moveAtTime',
      { engine },
      {
        elementId: result.elementId,
        fromTimeMs: 500,
        toTimeMs: 900,
      },
    )

    const element = getElement(engine.project, result.elementId)
    expect(element?.keyframes?.opacity?.map((keyframe) => keyframe.timeMs)).toEqual([900])
  })

  test('creates a multicam from selected video clips with a selected audio clip as its audio source', async () => {
    const engine = new EditorEngine()
    engine.dispatch({ type: 'addTrack', id: 't-cam' })
    engine.dispatch({ type: 'addTrack', id: 't-mic' })
    for (const [id, kind] of [
      ['a-screen', 'video'],
      ['a-cam', 'video'],
      ['a-mic', 'audio'],
    ] as const) {
      engine.dispatch({ type: 'addAsset', asset: { id, kind, src: `blob:${id}`, durationMs: 10_000 } })
    }
    const clip = { startMs: 0, durationMs: 5000 }
    engine.dispatch({ type: 'addElement', trackId: 't-default', element: { ...clip, type: 'video', id: 'e-screen', assetId: 'a-screen' } })
    engine.dispatch({ type: 'addElement', trackId: 't-cam', element: { ...clip, type: 'video', id: 'e-cam', assetId: 'a-cam' } })
    engine.dispatch({ type: 'addElement', trackId: 't-mic', element: { ...clip, type: 'audio', id: 'e-mic', assetId: 'a-mic' } })
    engine.select(['e-screen', 'e-cam', 'e-mic'])

    await runOperator('multicam.createFromSelection', { engine })

    const multicam = engine.project.tracks.flatMap((track) => track.elements).find((element) => element.type === 'multicam')
    expect(multicam?.type === 'multicam' ? { sources: multicam.sources, audioSource: multicam.audioSource } : null).toEqual({
      sources: [
        { key: 'screen', assetId: 'a-screen', offsetMs: 0 },
        { key: 'camera', assetId: 'a-cam', offsetMs: 0 },
        { key: 'audio', assetId: 'a-mic', offsetMs: 0 },
      ],
      audioSource: 'audio',
    })
  })

  test('reverse toggles a multicam-only selection', async () => {
    const engine = new EditorEngine()
    engine.dispatch({ type: 'addTrack', id: 't-cam' })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 20000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:cam', durationMs: 20000 } })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 10000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-cam',
      element: { id: 'e-cam', type: 'video', assetId: 'a-cam', startMs: 0, durationMs: 10000 },
    })
    engine.dispatch({ type: 'createMulticam', sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }], multicamId: 'e-mc' })
    engine.select(['e-mc'])

    expect(listOperators({ engine }).find((operator) => operator.id === 'edit.toggleReverseSelection')?.enabled).toBe(true)
    await runOperator('edit.toggleReverseSelection', { engine })
    expect(getElement(engine.project, 'e-mc')).toMatchObject({ type: 'multicam', reversed: true })
    await runOperator('edit.toggleReverseSelection', { engine })
    expect(getElement(engine.project, 'e-mc')).toMatchObject({ type: 'multicam', reversed: false })
  })

  test('trim to the playhead moves a multicam in-point', async () => {
    const engine = new EditorEngine()
    engine.dispatch({ type: 'addTrack', id: 't-cam' })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 20000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:cam', durationMs: 20000 } })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 10000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-cam',
      element: { id: 'e-cam', type: 'video', assetId: 'a-cam', startMs: 0, durationMs: 10000 },
    })
    engine.dispatch({ type: 'createMulticam', sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }], multicamId: 'e-mc' })
    const before = getElement(engine.project, 'e-mc')
    const angles = before?.type === 'multicam' ? before.angles.map((angle) => ({ atMs: angle.atMs, layoutId: angle.layoutId })) : []
    engine.seek(2500)
    engine.select(['e-mc'])

    await runOperator('edit.trimSelectionToPlayhead', { engine }, { edge: 'start' })

    expect(getElement(engine.project, 'e-mc')).toMatchObject({ startMs: 2500, durationMs: 7500, trimStartMs: 2500, angles })
  })

  test('audio.cleanVoice toggles selected media in one undo step', async () => {
    const engine = new EditorEngine()
    const track = engine.project.tracks[0]
    if (!track) throw new Error('missing track')
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 20_000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-aud', kind: 'audio', src: 'blob:audio', durationMs: 20_000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:cam', durationMs: 20_000 } })
    engine.dispatch({
      type: 'addElement',
      trackId: track.id,
      element: { type: 'video', id: 'e-vid', assetId: 'a-vid', startMs: 0, durationMs: 2000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: track.id,
      element: {
        type: 'audio',
        id: 'e-aud',
        assetId: 'a-aud',
        startMs: 2000,
        durationMs: 2000,
        voice: { enabled: true, amount: 0.25 },
      },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: track.id,
      element: {
        type: 'multicam',
        id: 'e-mc',
        startMs: 4000,
        durationMs: 2000,
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
      trackId: track.id,
      element: { type: 'text', id: 'e-text', text: 'title', startMs: 6000, durationMs: 1000 },
    })

    engine.select(['e-text'])
    const disabled = listOperators({ engine }).find((operator) => operator.id === 'audio.cleanVoice')
    expect(disabled?.label).toBe('Clean up voice')
    expect(disabled?.enabled).toBe(false)
    await expect(runOperator('audio.cleanVoice', { engine })).rejects.toThrow(OperatorError)

    engine.select(['e-vid', 'e-aud', 'e-mc', 'e-text'])
    expect(listOperators({ engine }).find((operator) => operator.id === 'audio.cleanVoice')?.enabled).toBe(true)
    await runOperator('audio.cleanVoice', { engine })
    expect(voiceOf(engine, 'e-vid')).toEqual({ enabled: true, amount: 1 })
    expect(voiceOf(engine, 'e-aud')).toEqual({ enabled: true, amount: 0.25 })
    expect(voiceOf(engine, 'e-mc')).toEqual({ enabled: true, amount: 1 })
    expect(getElement(engine.project, 'e-text')?.type).toBe('text')

    engine.undo()
    expect(voiceOf(engine, 'e-vid')).toBeUndefined()
    expect(voiceOf(engine, 'e-aud')).toEqual({ enabled: true, amount: 0.25 })
    expect(voiceOf(engine, 'e-mc')).toBeUndefined()

    engine.select(['e-aud'])
    await runOperator('audio.cleanVoice', { engine })
    expect(voiceOf(engine, 'e-aud')).toEqual({ enabled: false, amount: 0.25 })
  })

  test('rejects a missing media-bin asset with a typed operator error', async () => {
    const engine = new EditorEngine()

    const thrown = await runOperator('media.insertAssetAtPlayhead', { engine }, { assetId: 'a-missing' }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(thrown).toBeInstanceOf(OperatorError)
    expect(thrown).toMatchObject({ code: 'unknown-asset', message: 'no asset "a-missing"' })
  })
})
