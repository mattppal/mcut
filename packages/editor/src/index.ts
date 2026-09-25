export { OperatorError, enabledStatus, type EditorOperatorContext, type EnabledResult, type OperatorCategory, type OperatorDefinition } from './operators'

export { listOperators, operatorIds, operators, parseOperatorId, runOperator, type ListedEditorOperator, type OperatorId } from './core-operators'

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
  keyframeTimes,
  moveKeyframesAtTime,
  removeKeyframesAtTime,
  removeSelection,
  retimeSequentialCollage,
  selectTrackElements,
  shuttle,
  splitAllAtPlayhead,
  splitSelectionAtPlayhead,
  toggleMasterKeyframe,
  toggleSoloTrack,
  trackOfSelection,
  trimSelectionToPlayhead,
  unlinkElements,
  TEXT_PRESETS,
  type SequentialCollageLayout,
  type SequentialVideoCollageOptions,
  type SequentialVideoCollageResult,
  type TextPreset,
} from './timeline-operators'

export {
  canPlaceIgnoring,
  collectClipDragBases,
  computeSlipRange,
  planAutoCrossfade,
  planDuplicateClipsToNewTracks,
  resolveToolMode,
  type AutoCrossfadePlanInput,
  type ClipDragBase,
  type ClipDragMode,
  type DuplicateClipsToNewTracksOptions,
  type DuplicateClipsToNewTracksPlan,
  type ResolvedClipDragMode,
} from './timeline-gesture'

export { planZoomAtPlayhead, planZoomRegionDrag, type ZoomRegionDragMode, type ZoomShape } from './zoom-gesture'

export {
  planSilenceCuts,
  silenceCutOptionsSchema,
  type SilenceCutOptions,
  type SilenceCutPlan,
  type SilenceCutTranscript,
  type SilenceWindow,
} from './silence-cuts'

export { centerPersonOptionsSchema, planCenterPerson, type CenterPersonOptions, type FaceSample } from './center-person'

export { applyCommands, summarizeEngine, withPlayheadDefaults } from './headless'
export { lintProject, type LintIssue } from './lint'
export { PLATFORM_PRESETS, getPlatformPreset, type PlatformPreset } from './platform-presets'
