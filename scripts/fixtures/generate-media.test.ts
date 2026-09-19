import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANIFEST_FILE, generateFixtures } from './generate-media'
import { parseManifest, type FixtureManifest, type ManifestMutation } from './manifest'
import { recipes } from './recipes'
import { detectTooling, probeTruth } from './render'

const subset = ['counter-h264-mp4', 'gaps-pcm-wav', 'rotate90-h264-mp4']
const tooling = await detectTooling()

describe.skipIf(tooling === null)('generate-media', () => {
  let outDir = ''
  let manifest: FixtureManifest
  let firstLog: string[] = []
  let secondLog: string[] = []
  let firstManifestBytes = ''

  const selected = recipes.filter((recipe) => subset.includes(recipe.id))
  const fixtureFile = (id: string) => join(outDir, `${id}.${id.endsWith('wav') ? 'wav' : 'mp4'}`)
  const mutationById = (id: string): ManifestMutation => {
    const entry = manifest.mutations.find((mutation) => mutation.id === id)
    if (entry === undefined) throw new Error(`manifest has no mutation ${id}`)
    return entry
  }

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'mcut-fixtures-'))
    await generateFixtures({ outDir, recipes: selected, mutate: true, log: (line) => firstLog.push(line) })
    firstManifestBytes = await readFile(join(outDir, MANIFEST_FILE), 'utf8')
    manifest = await generateFixtures({ outDir, recipes: selected, mutate: true, log: (line) => secondLog.push(line) })
  }, 120_000)

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  test('counter-h264-mp4 is 3000 ms of 640x360 h264 with an aac track', async () => {
    const truth = await probeTruth(fixtureFile('counter-h264-mp4'))
    expect(Math.abs(truth.durationMs - 3000)).toBeLessThanOrEqual(50)
    expect(truth.displayWidth).toBe(640)
    expect(truth.displayHeight).toBe(360)
    expect(truth.frames).toBe(90)
    expect(truth.videoCodec).toBe('h264')
    expect(truth.audioCodec).toBe('aac')
  })

  test('gaps-pcm-wav is 6000 ms of 48 kHz mono PCM with no video', async () => {
    const truth = await probeTruth(fixtureFile('gaps-pcm-wav'))
    expect(Math.abs(truth.durationMs - 6000)).toBeLessThanOrEqual(50)
    expect(truth.hasVideo).toBe(false)
    expect(truth.sampleRate).toBe(48_000)
    expect(truth.channels).toBe(1)
    expect(truth.audioCodec).toBe('pcm_s16le')
  })

  test('rotate90-h264-mp4 codes 640x360 frames that display as 360x640', async () => {
    const truth = await probeTruth(fixtureFile('rotate90-h264-mp4'))
    expect(Math.abs(truth.durationMs - 2000)).toBeLessThanOrEqual(50)
    expect(truth.width).toBe(640)
    expect(truth.height).toBe(360)
    expect(truth.rotation).toBe(90)
    expect(truth.displayWidth).toBe(360)
    expect(truth.displayHeight).toBe(640)
  })

  test('the manifest measures every fixture within its recipe tolerance', () => {
    expect(manifest.fixtures.map((fixture) => fixture.id).sort()).toEqual([...subset].sort())
    for (const fixture of manifest.fixtures) {
      const { expected } = fixture.recipe
      expect(fixture.skipped).toBeNull()
      expect(fixture.measured).not.toBeNull()
      if (fixture.measured === null) continue
      expect(Math.abs(fixture.measured.durationMs - expected.durationMs)).toBeLessThanOrEqual(expected.tolerance)
      expect(fixture.measured.displayWidth).toBe(expected.width)
      expect(fixture.measured.displayHeight).toBe(expected.height)
      expect(fixture.measured.hasVideo).toBe(expected.hasVideo)
      expect(fixture.measured.hasAudio).toBe(expected.hasAudio)
    }
  })

  test('a second run reuses every output and rewrites the manifest byte for byte', async () => {
    expect(firstLog.filter((line) => line.endsWith('rendered'))).toHaveLength(firstLog.length)
    expect(secondLog.filter((line) => line.endsWith('cached'))).toHaveLength(secondLog.length)
    expect(secondLog).toHaveLength(firstLog.length)
    expect(await readFile(join(outDir, MANIFEST_FILE), 'utf8')).toBe(firstManifestBytes)
    expect(parseManifest(JSON.parse(firstManifestBytes))).toEqual(manifest)
  })

  test('mutations truncate, cut the header, flip bytes in the middle, and move moov behind mdat', async () => {
    const base = new Uint8Array(await readFile(fixtureFile('counter-h264-mp4')))
    const read = (id: string) => readFile(join(outDir, mutationById(id).file))

    expect((await read('counter-h264-mp4.trunc50')).length).toBe(Math.floor(base.length / 2))
    expect((await read('counter-h264-mp4.trunc10')).length).toBe(Math.floor(base.length / 10))
    expect((await read('counter-h264-mp4.head4k')).length).toBe(4096)

    const flip = mutationById('counter-h264-mp4.flip')
    const flipped = new Uint8Array(await read(flip.id))
    expect(flipped.length).toBe(base.length)
    const changed = [...flipped.keys()].filter((index) => flipped[index] !== base[index])
    expect(changed.length).toBeGreaterThan(0)
    expect(flip.mutation.kind === 'byte-flip' && changed.length <= flip.mutation.flips).toBe(true)
    expect(Math.min(...changed)).toBeGreaterThanOrEqual(Math.floor(base.length * 0.1))
    expect(Math.max(...changed)).toBeLessThan(Math.floor(base.length * 0.9))

    const atom = (bytes: Uint8Array, name: string) => Buffer.from(bytes).indexOf(name, 0, 'latin1')
    expect(atom(base, 'moov')).toBeLessThan(atom(base, 'mdat'))
    const moovEnd = new Uint8Array(await read('counter-h264-mp4.moovend'))
    expect(atom(moovEnd, 'moov')).toBeGreaterThan(atom(moovEnd, 'mdat'))
    expect(mutationById('counter-h264-mp4.moovend').expected).toBe('reject-or-partial')
  })
})
