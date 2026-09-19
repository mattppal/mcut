import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()

import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { EditorEngine } from '@mcut/timeline'
import { EditorProvider } from './context'
import { useEditor, useEditorState, usePlayback, useProject, useSelectedElement } from './hooks'

const { act, renderHook } = await import('@testing-library/react')

function providerFor(engine: EditorEngine) {
  return ({ children }: { children: ReactNode }) => (
    <EditorProvider engine={engine}>{children}</EditorProvider>
  )
}

describe('editor hooks', () => {
  test('useProject re-renders with the project after a dispatch', () => {
    const engine = new EditorEngine()
    const { result } = renderHook(() => useProject().tracks.map((track) => track.name), {
      wrapper: providerFor(engine),
    })
    expect(result.current).toEqual(['Track 1'])
    act(() => {
      engine.dispatch({ type: 'addTrack', name: 'Overlay' })
    })
    expect(result.current).toEqual(['Track 1', 'Overlay'])
  })

  test('useEditorState selects a slice and follows undo history', () => {
    const engine = new EditorEngine()
    const { result } = renderHook(() => useEditorState((state) => state.canUndo), {
      wrapper: providerFor(engine),
    })
    expect(result.current).toBe(false)
    act(() => {
      engine.dispatch({ type: 'addTrack', name: 'Overlay' })
    })
    expect(result.current).toBe(true)
    act(() => {
      engine.undo()
    })
    expect(result.current).toBe(false)
  })

  test('usePlayback re-renders with the playhead after a seek', () => {
    const engine = new EditorEngine()
    const { result } = renderHook(() => usePlayback((state) => state.currentTimeMs), {
      wrapper: providerFor(engine),
    })
    expect(result.current).toBe(0)
    act(() => {
      engine.seek(750)
    })
    expect(result.current).toBe(750)
  })

  test('useSelectedElement resolves the first selected element with its track', () => {
    const engine = new EditorEngine()
    engine.dispatch({ type: 'addTrack', id: 't-clips', name: 'Clips' })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-clips',
      element: { type: 'text', id: 'e-title', startMs: 0, durationMs: 1000, text: 'Title' },
    })
    const { result } = renderHook(() => useSelectedElement(), { wrapper: providerFor(engine) })
    expect(result.current).toBeUndefined()
    act(() => {
      engine.select(['e-title'])
    })
    const selected = result.current
    if (!selected) throw new Error('missing selected element')
    expect(selected.element.id).toBe('e-title')
    expect(selected.track.id).toBe('t-clips')
    expect(selected.trackIndex).toBe(1)
  })

  test('useEditor hands back the engine the provider was given', () => {
    const engine = new EditorEngine()
    const { result } = renderHook(() => useEditor(), { wrapper: providerFor(engine) })
    expect(result.current).toBe(engine)
  })

  test('hooks outside EditorProvider throw a named error', () => {
    expect(() => renderHook(() => useEditor())).toThrow(
      'mcut hooks must be used inside <EditorProvider>',
    )
  })
})
