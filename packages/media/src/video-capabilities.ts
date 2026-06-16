export interface VideoPreviewCapability {
  name?: string
  mimeType?: string
  nativePreview?: boolean
}

export function isMatroskaLike(media: VideoPreviewCapability): boolean {
  const name = media.name?.toLowerCase() ?? ''
  const mime = media.mimeType?.toLowerCase() ?? ''
  return (
    name.endsWith('.mkv') ||
    name.endsWith('.mk3d') ||
    name.endsWith('.mka') ||
    mime.includes('matroska') ||
    mime === 'video/x-matroska'
  )
}

/** canPlayType per mimeType — this can run on every preview frame. */
const canPlayTypeCache = new Map<string, boolean>()

/**
 * Whether an asset should use browser-native `<video>` playback/frame capture
 * instead of Mediabunny/WebCodecs decoded frames.
 */
export function canUseNativeVideoPreview(media: VideoPreviewCapability): boolean {
  if (media.nativePreview === false || isMatroskaLike(media)) return false
  // Import probes actual decodability (canPlayType answers "" for QuickTime
  // files Chrome plays fine) — its verdict beats re-deriving from mimeType.
  if (media.nativePreview === true) return true
  if (typeof document === 'undefined') return true
  const mimeType = media.mimeType
  if (!mimeType?.startsWith('video/')) return true
  let playable = canPlayTypeCache.get(mimeType)
  if (playable === undefined) {
    playable = document.createElement('video').canPlayType(mimeType) !== ''
    canPlayTypeCache.set(mimeType, playable)
  }
  return playable
}
