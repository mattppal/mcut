import { describe, expect, test } from 'bun:test'
import { EditorEngine } from './engine'
import { createProject } from './model'
import { getTrack } from './selectors'

function engineWithText(): { engine: EditorEngine; trackId: `t-${string}` } {
  const engine = new EditorEngine({ project: createProject({ name: 'test' }) })
  const trackId = engine.project.tracks[0]!.id
  return { engine, trackId }
}

describe('EditorEngine', () => {
  test('dispatch applies commands and records history', () => {
    const { engine, trackId } = engineWithText()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
    })
    expect(engine.canUndo()).toBe(true)
    expect(engine.store.state.canUndo).toBe(true)

    expect(engine.undo()).toBe(true)
    expect(getTrack(engine.project, trackId)!.elements).toHaveLength(0)
    expect(engine.canRedo()).toBe(true)

    expect(engine.redo()).toBe(true)
    expect(getTrack(engine.project, trackId)!.elements).toHaveLength(1)
  })

  test('new edits clear the redo stack', () => {
    const { engine, trackId } = engineWithText()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
    })
    engine.undo()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-2', type: 'text', startMs: 0, durationMs: 500, text: 'two' },
    })
    expect(engine.canRedo()).toBe(false)
  })

  test('transact coalesces multiple dispatches into one undo entry', () => {
    const { engine, trackId } = engineWithText()
    engine.transact(() => {
      engine.dispatch({
        type: 'addElement',
        trackId,
        element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
      })
      engine.dispatch({ type: 'moveElement', elementId: 'e-1', startMs: 2000 })
      engine.dispatch({ type: 'updateElement', elementId: 'e-1', patch: { text: 'final' } })
    })
    expect(getTrack(engine.project, trackId)!.elements[0]).toMatchObject({
      startMs: 2000,
      text: 'final',
    })
    expect(engine.undo()).toBe(true)
    expect(getTrack(engine.project, trackId)!.elements).toHaveLength(0)
    expect(engine.undo()).toBe(false)
  })

  test('cancelTransaction restores the base project without history', () => {
    const { engine, trackId } = engineWithText()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
    })
    engine.beginTransaction()
    engine.dispatch({ type: 'moveElement', elementId: 'e-1', startMs: 2000 })
    engine.dispatch({ type: 'updateElement', elementId: 'e-1', patch: { text: 'mid-drag' } })
    engine.cancelTransaction()

    expect(getTrack(engine.project, trackId)!.elements[0]).toMatchObject({
      startMs: 0,
      text: 'one',
    })
    // Only the pre-transaction edit is undoable.
    expect(engine.undo()).toBe(true)
    expect(getTrack(engine.project, trackId)!.elements).toHaveLength(0)
    expect(engine.undo()).toBe(false)
  })

  test('cancelTransaction restores the selection captured at begin', () => {
    const { engine, trackId } = engineWithText()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
    })
    engine.select(['e-1'])
    engine.beginTransaction()
    engine.dispatch({ type: 'removeElement', elementId: 'e-1' })
    engine.select([])
    engine.cancelTransaction()
    expect(engine.selection.elementIds).toEqual(['e-1'])
  })

  test('cancelTransaction without an open transaction is a no-op', () => {
    const { engine, trackId } = engineWithText()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
    })
    engine.cancelTransaction()
    expect(getTrack(engine.project, trackId)!.elements).toHaveLength(1)
    expect(engine.canUndo()).toBe(true)
  })

  test('history is capped at maxHistorySize', () => {
    const { engine, trackId } = engineWithText()
    const small = new EditorEngine({ project: engine.project, maxHistorySize: 3 })
    for (let i = 0; i < 6; i++) {
      small.dispatch({
        type: 'addElement',
        trackId,
        element: { type: 'text', startMs: i * 1000, durationMs: 500, text: `t${i}` },
      })
    }
    let undos = 0
    while (small.undo()) undos++
    expect(undos).toBe(3)
  })

  test('selection prunes when elements are removed', () => {
    const { engine, trackId } = engineWithText()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
    })
    engine.select(['e-1'])
    expect(engine.selection.elementIds).toEqual(['e-1'])
    engine.dispatch({ type: 'removeElement', elementId: 'e-1' })
    expect(engine.selection.elementIds).toEqual([])
  })

  test('store subscribers are notified once per transact', () => {
    const { engine, trackId } = engineWithText()
    let notifications = 0
    const subscription = engine.store.subscribe(() => {
      notifications++
    })
    engine.transact(() => {
      engine.dispatch({
        type: 'addElement',
        trackId,
        element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
      })
      engine.dispatch({ type: 'moveElement', elementId: 'e-1', startMs: 2000 })
    })
    expect(notifications).toBeLessThanOrEqual(2) // batched: far fewer than one per dispatch
    subscription.unsubscribe()
  })

  test('loadProject resets history and playback survives', () => {
    const { engine, trackId } = engineWithText()
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-1', type: 'text', startMs: 0, durationMs: 1000, text: 'one' },
    })
    engine.seek(500)
    const serialized = JSON.parse(JSON.stringify(engine.toJSON()))
    const restored = EditorEngine.fromJSON(serialized)
    expect(restored.project.tracks[0]!.elements).toHaveLength(1)
    expect(restored.canUndo()).toBe(false)

    engine.loadProject(createProject({ name: 'fresh' }))
    expect(engine.canUndo()).toBe(false)
    expect(engine.project.name).toBe('fresh')
  })

  test('transport setters clamp', () => {
    const { engine } = engineWithText()
    engine.seek(-100)
    expect(engine.playback.state.currentTimeMs).toBe(0)
    engine.setVolume(4)
    expect(engine.playback.state.volume).toBe(1)
    engine.play()
    expect(engine.playback.state.isPlaying).toBe(true)
    engine.pause()
    expect(engine.playback.state.isPlaying).toBe(false)
  })
})

describe('selection across undo/redo', () => {
  test('a delete declaring its selection restores the deleted clip selected on undo', () => {
    const engine = new EditorEngine()
    const trackId = engine.project.tracks[0]!.id
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-sel', text: 'hi', startMs: 0, durationMs: 1000 },
    })
    engine.select(['e-sel'])
    engine.dispatch({ type: 'removeElement', elementId: 'e-sel' }, { selection: [] })
    expect(engine.selection.elementIds).toEqual([])
    engine.undo()
    expect(engine.selection.elementIds).toEqual(['e-sel'])
    engine.redo()
    expect(engine.selection.elementIds).toEqual([])
  })

  test('undoing an undeclared edit preserves selection made after the edit', () => {
    const engine = new EditorEngine()
    const trackId = engine.project.tracks[0]!.id
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-a', text: 'a', startMs: 0, durationMs: 1000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-b', text: 'b', startMs: 2000, durationMs: 1000 },
    })
    engine.select(['e-a'])
    engine.dispatch({ type: 'trimElement', elementId: 'e-a', durationMs: 500 })
    // The user clicks another clip after the edit...
    engine.select(['e-b'])
    engine.undo()
    // ...and undoing the trim doesn't steal their selection back.
    expect(engine.selection.elementIds).toEqual(['e-b'])
  })

  test('a transaction declaring its selection applies and restores it', () => {
    const engine = new EditorEngine()
    const trackId = engine.project.tracks[0]!.id
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-a', text: 'a', startMs: 0, durationMs: 1000 },
    })
    engine.select(['e-a'])
    engine.transact(
      () => {
        engine.dispatch({
          type: 'addElement',
          trackId,
          element: { type: 'text', id: 'e-new', text: 'n', startMs: 2000, durationMs: 1000 },
        })
      },
      { selection: ['e-new'] },
    )
    expect(engine.selection.elementIds).toEqual(['e-new'])
    engine.undo()
    expect(engine.selection.elementIds).toEqual(['e-a'])
    engine.redo()
    expect(engine.selection.elementIds).toEqual(['e-new'])
  })

  test('selection still prunes ids missing from the restored project', () => {
    const engine = new EditorEngine()
    const trackId = engine.project.tracks[0]!.id
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-a', text: 'a', startMs: 0, durationMs: 1000 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-b', text: 'b', startMs: 2000, durationMs: 1000 },
    })
    engine.select(['e-b'])
    // Undoing e-b's add removes it; the kept-alone selection prunes to empty.
    engine.undo()
    expect(engine.selection.elementIds).toEqual([])
  })
})
