import { describe, expect, test } from 'bun:test'
import { getFilmstrip } from './filmstrip'

const malformedVideoUrl = 'data:video/mp4;base64,AAAA'

describe('filmstrips', () => {
  test('returns null when native and decoded filmstrip paths cannot read the source', async () => {
    await expect(getFilmstrip(malformedVideoUrl, { frameCount: 4 })).resolves.toBeNull()
  })
})
