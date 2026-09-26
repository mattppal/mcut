import { toast } from 'sonner'
import type { BuiltinCommand, EditorEngine } from '@mcut/timeline'

export function dispatchSafe(engine: EditorEngine, command: BuiltinCommand): boolean {
  try {
    engine.dispatch(command)
    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Edit failed')
    return false
  }
}

export {
  addTextAtPlayhead,
  allElementIds,
  clipEdges,
  createSequentialVideoCollage,
  duplicateElement,
  duplicateSelection,
  elementForAsset,
  elementForTextPreset,
  fitCanvasToVideoCollage,
  insertElementAtPlayhead,
  insertElementOnNewTrack,
  insertElementOnTrack,
  isSoloTrack,
  removeSelection,
  retimeSequentialCollage,
  selectTrackElements,
  shuttle,
  splitAllAtPlayhead,
  splitSelectionAtPlayhead,
  TEXT_PRESETS,
  toggleMasterKeyframe,
  toggleSoloTrack,
  trackOfSelection,
  trimSelectionToPlayhead,
  unlinkElements,
  type SequentialCollageLayout,
  type SequentialVideoCollageOptions,
  type SequentialVideoCollageResult,
  type TextPreset,
} from '@mcut/editor'
