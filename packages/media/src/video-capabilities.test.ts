import { describe, expect, test } from 'bun:test'
import { canUseNativeVideoPreview, isMatroskaLike } from './video-capabilities'

describe('video preview capabilities', () => {
  test('treats Matroska-like files as decoded-path assets', () => {
    expect(isMatroskaLike({ name: 'clip.mkv' })).toBe(true)
    expect(isMatroskaLike({ name: 'audio.mka' })).toBe(true)
    expect(isMatroskaLike({ mimeType: 'video/x-matroska' })).toBe(true)
    expect(canUseNativeVideoPreview({ name: 'clip.mkv', nativePreview: true })).toBe(false)
  })

  test('uses the persisted native preview verdict when available', () => {
    expect(canUseNativeVideoPreview({ nativePreview: true })).toBe(true)
    expect(canUseNativeVideoPreview({ nativePreview: false })).toBe(false)
  })
})
