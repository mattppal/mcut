import { describe, expect, test } from 'bun:test'
import { EditorEngine, getElement } from '@mcut/timeline'
import { createEditorOperatorRegistry, OperatorError, registerCoreOperators } from './index'

describe('editor operators', () => {
  test('runs a user-level text insertion operator', async () => {
    const engine = new EditorEngine()
    const registry = registerCoreOperators(createEditorOperatorRegistry())

    const result = await registry.run('edit.addTextAtPlayhead', { engine }, { text: 'Hello' })

    expect(result).toEqual({ elementId: expect.stringMatching(/^e-/) })
    expect(engine.project.tracks).toHaveLength(1)
    const elementId = engine.selection.elementIds[0]
    const element = elementId ? getElement(engine.project, elementId) : null
    expect(element?.type).toBe('text')
    expect(element && 'text' in element ? element.text : null).toBe('Hello')
  })

  test('reports disabled operators before running them', async () => {
    const engine = new EditorEngine()
    const registry = registerCoreOperators(createEditorOperatorRegistry())

    expect(registry.isEnabled('edit.deleteSelection', { engine })).toBe(false)
    await expect(registry.run('edit.deleteSelection', { engine })).rejects.toThrow(OperatorError)
  })

  test('moves aggregate keyframes through a semantic keyframe operator', async () => {
    const engine = new EditorEngine()
    const registry = registerCoreOperators(createEditorOperatorRegistry())
    const result = (await registry.run('edit.addTextAtPlayhead', { engine }, { text: 'Title' })) as {
      elementId: `e-${string}`
    }

    engine.dispatch({
      type: 'setKeyframe',
      elementId: result.elementId,
      property: 'opacity',
      timeMs: 500,
      value: 0.2,
    })

    await registry.run('keyframes.moveAtTime', { engine }, {
      elementId: result.elementId,
      fromTimeMs: 500,
      toTimeMs: 900,
    })

    const element = getElement(engine.project, result.elementId)
    expect(element?.keyframes?.opacity?.map((keyframe) => keyframe.timeMs)).toEqual([900])
  })
})
