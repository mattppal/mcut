export type {
  TranscribeInput,
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptResult,
  TranscriptSegment,
  TranscriptWord,
} from './types'

export {
  toSrt,
  toVtt,
  transcriptToCues,
  type SubtitleCue,
} from './subtitles'

export {
  buildApplyCaptionsCommand,
  groupWords,
  toCaptionElements,
  type BuildApplyCaptionsOptions,
  type CaptionElementInput,
  type GroupWordsOptions,
  type ToCaptionElementsOptions,
  type WordGroup,
} from './captions'

export {
  mapCaptionWords,
  mergeCaptions,
  replaceAllMatches,
  replaceMatch,
  retypeWord,
  searchCaptions,
  splitCaptionAtWord,
  type CaptionContentPatch,
  type CaptionMergeResult,
  type CaptionSplitResult,
  type MappedWord,
  type TranscriptCaption,
  type TranscriptMatch,
} from './transcript-tools'
