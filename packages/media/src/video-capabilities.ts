export interface VideoPreviewCapability {
  name?: string
  mimeType?: string
  nativePreview?: boolean
}

export function isMatroskaLike(media: VideoPreviewCapability): boolean {
  const name = media.name?.toLowerCase() ?? ''
  const mime = media.mimeType?.toLowerCase() ?? ''
  return name.endsWith('.mkv') || name.endsWith('.mk3d') || name.endsWith('.mka') || mime.includes('matroska') || mime === 'video/x-matroska'
}

const canPlayTypeCache = new Map<string, boolean>()

export function canUseNativeVideoPreview(media: VideoPreviewCapability): boolean {
  if (media.nativePreview === false || isMatroskaLike(media)) return false
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
