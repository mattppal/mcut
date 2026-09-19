export {
  transcriptInputSchema,
  transcriptResultSchema,
  type TranscribeInput,
  type TranscribeOptions,
  type TranscriptionProvider,
  type TranscriptResult,
  type TranscriptSegment,
  type TranscriptWord,
} from './types'

export {
  toSrt,
  toVtt,
  transcriptToCues,
  type SubtitleCue,
} from './subtitles'

export {
  buildApplyCaptionsCommand,
  buildCaptionsCommand,
  captionsCommandOptionsSchema,
  groupWords,
  toCaptionElements,
  type BuildApplyCaptionsOptions,
  type CaptionElementInput,
  type CaptionsCommandOptions,
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
