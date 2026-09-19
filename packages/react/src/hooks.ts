'use client'

import { useSelector } from '@tanstack/react-store'
import {
  getElementLocation,
  type EditorEngine,
  type EditorState,
  type ElementLocation,
  type PlaybackState,
  type Project,
  type SelectionState,
} from '@mcut/timeline'
import { useEditorContext } from './context'

export function useEditor(): EditorEngine {
  return useEditorContext().engine
}

export function useEditorState<TSelected = EditorState>(
  selector?: (state: EditorState) => TSelected,
  compare?: (a: TSelected, b: TSelected) => boolean,
): TSelected {
  const { engine } = useEditorContext()
  return useSelector(engine.store, selector, compare ? { compare } : undefined)
}

export function usePlayback<TSelected = PlaybackState>(
  selector?: (state: PlaybackState) => TSelected,
  compare?: (a: TSelected, b: TSelected) => boolean,
): TSelected {
  const { engine } = useEditorContext()
  return useSelector(engine.playback, selector, compare ? { compare } : undefined)
}

export function useProject(): Project {
  return useEditorState((state) => state.project)
}

export function useSelection(): SelectionState {
  return useEditorState((state) => state.selection)
}

export function useSelectedElement(): ElementLocation | undefined {
  return useEditorState(
    (state) => {
      const id = state.selection.elementIds[0]
      return id ? getElementLocation(state.project, id) : undefined
    },
    (a, b) => a?.element === b?.element && a?.track === b?.track && a?.trackIndex === b?.trackIndex,
  )
}
