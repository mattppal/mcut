import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()

import { describe, expect, test } from 'bun:test'
import { EditorEngine } from '@mcut/timeline'
import { useEngineSync } from './use-engine-sync'

const { act, renderHook } = await import('@testing-library/react')

describe('useEngineSync', () => {
  test('syncs the selected value on mount, on each change of it, and never after unmount', () => {
    const engine = new EditorEngine()
    engine.dispatch({ type: 'addTrack', id: 't-clips', name: 'Clips' })
    const seen: string[] = []
    const { unmount } = renderHook(() =>
      useEngineSync(
        engine.store,
        (state) => state.project.tracks.map((track) => track.name).join(','),
        (names) => {
          seen.push(names)
        },
      ),
    )
    expect(seen).toEqual(['Track 1,Clips'])
    act(() => {
      engine.select(['e-missing'])
    })
    expect(seen).toEqual(['Track 1,Clips'])
    act(() => {
      engine.dispatch({ type: 'renameTrack', trackId: 't-clips', name: 'Overlay' })
    })
    expect(seen).toEqual(['Track 1,Clips', 'Track 1,Overlay'])
    unmount()
    act(() => {
      engine.dispatch({ type: 'addTrack', name: 'Music' })
    })
    expect(seen).toEqual(['Track 1,Clips', 'Track 1,Overlay'])
  })
})
