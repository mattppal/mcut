import { expect, test } from 'bun:test'
import type { AssetRef } from '@mcut/timeline'
import { PreviewMediaPool } from './preview-pool'

test('a decoded clip requested right after load starts decoding, and a failed start moves the frame version once the retry window passes', async () => {
  const asset: AssetRef = { id: 'a-mkv', kind: 'video', src: 'data:video/x-matroska;base64,AAAAAAAAAAAAAAAA', nativePreview: false }
  const pool = new PreviewMediaPool(() => asset)
  expect(pool.getFrame(asset.id, 0)).toBeNull()

  const deadline = performance.now() + 8000
  while (pool.frameVersion === 0 && performance.now() < deadline) await Bun.sleep(50)
  expect(pool.frameVersion).toBe(1)
  pool.dispose()
}, 10_000)
