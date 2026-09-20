import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { fixturesDir, loadFixtureManifest } from './fuzz/fixtures'
import { createAsset, mediabunnyProber, type MediaOrigin, type MediaProbe, type MediaProber } from './probe'

const fixtureId = 'counter-vp9-webm'
const dir = fixturesDir()
const fixture = loadFixtureManifest(dir)?.fixtures.find((entry) => entry.id === fixtureId && entry.skipped === null)

test('createAsset builds the asset from whatever probe the given prober returns', async () => {
  const origin: MediaOrigin = { kind: 'blob', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }), name: 'stub.webm' }
  const fixed: MediaProbe = { durationMs: 4321, hasVideo: true, hasAudio: false, width: 1234, height: 567, mimeType: 'video/webm' }
  const seen: MediaOrigin[] = []
  const stub: MediaProber = {
    id: 'mediabunny',
    probe: async (received) => {
      seen.push(received)
      return fixed
    },
  }

  const asset = await createAsset(origin, stub)

  expect(seen).toEqual([origin])
  expect(asset.kind).toBe('video')
  expect(asset.name).toBe('stub.webm')
  expect(asset.mimeType).toBe('video/webm')
  if (asset.kind !== 'video') throw new Error(`expected a video asset, got ${asset.kind}`)
  expect(asset.durationMs).toBe(fixed.durationMs)
  expect(asset.width).toBe(fixed.width)
  expect(asset.height).toBe(fixed.height)
})

test.skipIf(fixture === undefined)(`mediabunnyProber reads ${fixtureId} to the manifest's dimensions`, async () => {
  if (fixture === undefined) throw new Error(`fixture ${fixtureId} is missing from ${dir}`)
  const expected = fixture.recipe.expected
  const blob = new Blob([await Bun.file(join(dir, fixture.file)).arrayBuffer()])

  const probe = await mediabunnyProber.probe({ kind: 'blob', blob, name: fixture.file })

  expect(mediabunnyProber.id).toBe('mediabunny')
  expect(probe.hasVideo).toBe(expected.hasVideo)
  expect(probe.hasAudio).toBe(expected.hasAudio)
  expect(probe.width).toBe(expected.width)
  expect(probe.height).toBe(expected.height)
  expect(Math.abs(probe.durationMs - expected.durationMs)).toBeLessThanOrEqual(expected.tolerance)
})
