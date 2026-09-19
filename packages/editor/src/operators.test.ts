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
