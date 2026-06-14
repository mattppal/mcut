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

/** The editor engine: dispatch commands, undo/redo, transport. */
export function useEditor(): EditorEngine {
  return useEditorContext().engine
}

/** Subscribe to a slice of editor state (project, selection, history flags). */
export function useEditorState<TSelected = EditorState>(
  selector?: (state: EditorState) => TSelected,
  compare?: (a: TSelected, b: TSelected) => boolean,
): TSelected {
  const { engine } = useEditorContext()
  return useSelector(engine.store, selector, compare ? { compare } : undefined)
}

/** Subscribe to a slice of playback state (time, playing, volume). */
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

/** The first selected element with its track, if any. */
export function useSelectedElement(): ElementLocation | undefined {
  return useEditorState(
    (state) => {
      const id = state.selection.elementIds[0]
      return id ? getElementLocation(state.project, id) : undefined
    },
    (a, b) => a?.element === b?.element && a?.track === b?.track && a?.trackIndex === b?.trackIndex,
  )
}
