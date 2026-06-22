import { describe, expect, test } from 'bun:test'
import { getVideoThumbnail, getVideoThumbnailUrl } from './thumbnails'

const malformedVideoUrl = 'data:video/mp4;base64,AAAA'

describe('video thumbnails', () => {
  test('returns null when native and decoded thumbnail paths cannot read the source', async () => {
    await expect(getVideoThumbnail(malformedVideoUrl)).resolves.toBeNull()
    await expect(getVideoThumbnailUrl(malformedVideoUrl)).resolves.toBeNull()
  })
})
