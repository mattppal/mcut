import { describe, expect, test } from 'bun:test'
import { EditorEngine, getElement } from '@mcut/timeline'
import { OperatorError, listOperators, parseOperatorId, runOperator } from './index'

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
