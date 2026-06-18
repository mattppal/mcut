export {
  createAssetFromFile,
  inputFor,
  probeImage,
  probeMedia,
  type MediaProbe,
  type MediaSourceLike,
} from './probe'

export {
  getVideoThumbnail,
  getVideoThumbnailUrl,
  type ThumbnailOptions,
} from './thumbnails'

export { AudioNotDecodableError, extractAudioToWav, type ExtractAudioOptions } from './extract-audio'

export { ensureFallbackAudioEncoders } from './encoders'

export {
  getActiveMediaItems,
  PreviewMediaPool,
  type ActiveMediaItem,
  type PreviewSyncOptions,
} from './preview-pool'

export {
  exportProject,
  getExportSupport,
  type ContainerFormatId,
  type ExportFontFaceInit,
  type ExportProgress,
  type ExportProjectOptions,
  type ExportResult,
} from './export'

export {
  getContainerFormat,
  listContainerFormats,
  registerContainerFormat,
  type ContainerFormatEntry,
} from './container-formats'

export { getFilmstrip, type Filmstrip, type FilmstripOptions } from './filmstrip'

export {
  canUseNativeVideoPreview,
  isMatroskaLike,
  type VideoPreviewCapability,
} from './video-capabilities'

export {
  bucketPeaks,
  extractAudioPeaks,
  type AudioPeaks,
  type AudioPeaksOptions,
} from './audio-peaks'

export {
  DEFAULT_ACTIVITY_FRAME_MS,
  DEFAULT_ACTIVITY_THRESHOLD,
  DEFAULT_MIN_SILENCE_MS,
  DEFAULT_MIN_SOUND_MS,
  analyzeAudioActivity,
  analyzeAudioSamples,
  type AudioActivity,
  type AudioActivityOptions,
  type AudioActivitySummary,
  type AudioActivityWindow,
} from './audio-activity'

export {
  MAX_HASHABLE_BYTES,
  hashBlob,
  isMediaStoreSupported,
  loadMediaBlob,
  pruneMediaBlobs,
  saveMediaBlob,
} from './media-store'

export { ScrubFrameCache } from './scrub-cache'

export { constantSpeedOf, stretchStereo, type ConstantSpeed, type StereoData } from './time-stretch'

export {
  crossCorrelateEnvelopes,
  extractEnvelope,
  findSyncOffsetMs,
  type AudioSyncOptions,
  type SyncResult,
} from './audio-sync'
