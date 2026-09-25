import { describe, expect, test } from 'bun:test'
import { parseProject, type AssetRef, type Project, type Voice } from '@mcut/timeline'
import { decodeWav, encodeWav } from '@mcut/voice'
import { createVoiceStems, type VoiceStemDeps, type VoiceStems } from './voice-stems'

interface Media {
  src: string
  hash?: string
}

function project(voice?: Voice, media: Media = { src: 'blob:talk', hash: 'abc' }): Project {
  return parseProject({
    id: 'p-voice',
    name: 'Voice',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      'a-talk': { id: 'a-talk', kind: 'video', ...media, name: 'talk.mp4', durationMs: 5000, width: 1920, height: 1080 },
    },
    tracks: [
      {
        id: 't-video',
        name: 'Video',
        elements: [{ id: 'e-talk', type: 'video', assetId: 'a-talk', startMs: 0, durationMs: 3000, trimStartMs: 0, ...(voice ? { voice } : {}) }],
      },
    ],
  })
}

function talk(current: Project): AssetRef {
  const asset = current.assets['a-talk']
  if (!asset) throw new Error('the project has no a-talk asset')
  return asset
}

function withoutClips(current: Project): Project {
  return { ...current, tracks: current.tracks.map((track) => ({ ...track, elements: [] })) }
}

function stalled(signals: AbortSignal[]): VoiceStemDeps['clean'] {
  return (_samples, _onProgress, signal) => {
    signals.push(signal)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }
}

function fakeDeps(clean: (samples: Float32Array) => Promise<Float32Array> = async (samples) => samples.map((sample) => sample / 2)) {
  const saved = new Map<string, Blob>()
  const calls = { clean: 0 }
  const deps: VoiceStemDeps = {
    decode: async () => Float32Array.from([0.5, -0.5, 0.25, 0]),
    clean: async (samples, onProgress) => {
      calls.clean++
      onProgress(0.5)
      return clean(samples)
    },
    load: async (name) => saved.get(name) ?? null,
    save: async (name, wav) => {
      saved.set(name, wav)
    },
  }
  return { deps, saved, calls }
}

async function samplesAt(url: string | undefined): Promise<number[]> {
  if (url === undefined) throw new Error('no audio source for the clip')
  const response = await fetch(url)
  return Array.from(decodeWav(new Uint8Array(await response.arrayBuffer())).samples)
}

async function processed(stems: VoiceStems, current: Project): Promise<void> {
  stems.reconcile(current)
  await stems.settled([talk(current)])
}

function readyUrl(stems: VoiceStems, current: Project): string {
  const stem = stems.status(talk(current))
  if (stem.state !== 'ready') throw new Error(`stem is ${stem.state}`)
  return stem.url
}

describe('voice stems', () => {
  test('cleans a clip when its voice turns on and plays the wet stem at full amount', async () => {
    const { deps, calls } = fakeDeps()
    const stems = createVoiceStems(deps)
    const voiced = project({ enabled: true, amount: 1 })
    stems.reconcile(voiced)
    expect(stems.status(talk(voiced)).state).toBe('processing')
    await stems.settled([talk(voiced)])
    stems.reconcile(voiced)
    expect(stems.audioSources(voiced).get('e-talk')).toBe(readyUrl(stems, voiced))
    expect(await samplesAt(readyUrl(stems, voiced))).toEqual([0.25, -0.25, 0.125, 0])
    expect(calls.clean).toBe(1)
  })

  test('leaves clips without voice on their own audio', () => {
    const { deps, calls } = fakeDeps()
    const stems = createVoiceStems(deps)
    const off = project({ enabled: false, amount: 1 })
    stems.reconcile(off)
    expect(stems.status(talk(off))).toEqual({ state: 'idle' })
    expect([...stems.audioSources(off)]).toEqual([])
    expect(calls.clean).toBe(0)
  })

  test.each([
    { identity: 'content hash', first: { src: 'blob:first', hash: 'first' }, second: { src: 'blob:second', hash: 'second' } },
    { identity: 'source URL', first: { src: 'blob:first' }, second: { src: 'blob:second' } },
  ])('cleans the new media when another project reuses its asset id, told apart by $identity', async ({ first, second }) => {
    const decoded: string[] = []
    const stems = createVoiceStems({
      ...fakeDeps().deps,
      decode: async (src) => {
        decoded.push(src)
        return Float32Array.of(src === 'blob:first' ? 0.25 : 0.75)
      },
    })
    const voice = { enabled: true, amount: 1 }
    await stems.ready(project(voice, first))
    const sources = await stems.ready(project(voice, second))
    expect(decoded).toEqual(['blob:first', 'blob:second'])
    expect(await samplesAt(sources.get('e-talk'))).toEqual([0.375])
  })

  test('reuses the stem saved by an earlier session instead of cleaning again', async () => {
    const { deps, saved, calls } = fakeDeps()
    const voiced = project({ enabled: true, amount: 1 })
    await processed(createVoiceStems(deps), voiced)
    const nextSession = createVoiceStems(deps)
    await processed(nextSession, voiced)
    expect([...saved.keys()]).toEqual(['voice-dfn3-cli-thresholds-1-abc.wav'])
    expect(await samplesAt(readyUrl(nextSession, voiced))).toEqual([0.25, -0.25, 0.125, 0])
    expect(calls.clean).toBe(1)
  })

  test('cleans again when the saved stem does not match the decoded audio', async () => {
    const { deps, saved, calls } = fakeDeps()
    saved.set('voice-dfn3-cli-thresholds-1-abc.wav', new Blob([encodeWav(Float32Array.from([0.1]), 48_000)]))
    const stems = createVoiceStems(deps)
    const voiced = project({ enabled: true, amount: 1 })
    await processed(stems, voiced)
    expect(await samplesAt(readyUrl(stems, voiced))).toEqual([0.25, -0.25, 0.125, 0])
    expect(calls.clean).toBe(1)
  })

  test('mixes dry and wet at a partial amount and revokes the mix it replaces', async () => {
    const stems = createVoiceStems(fakeDeps().deps)
    const half = project({ enabled: true, amount: 0.5 })
    await processed(stems, half)
    const halfUrl = stems.audioSources(half).get('e-talk')
    expect(await samplesAt(halfUrl)).toEqual([0.375, -0.375, 0.1875, 0])
    expect(stems.audioSources(half).get('e-talk')).toBe(halfUrl ?? 'missing')
    const quarterUrl = stems.audioSources(project({ enabled: true, amount: 0.25 })).get('e-talk')
    expect(await samplesAt(quarterUrl)).toEqual([0.4375, -0.4375, 0.21875, 0])
    await expect(samplesAt(halfUrl)).rejects.toThrow()
  })

  test('keeps a failed stem failed until the clip turns voice on again', async () => {
    let failing = true
    const { deps, calls } = fakeDeps(async (samples) => {
      if (failing) throw new Error('voice worker crashed')
      return samples
    })
    const stems = createVoiceStems(deps)
    const voiced = project({ enabled: true, amount: 1 })
    await processed(stems, voiced)
    stems.reconcile(voiced)
    expect(stems.status(talk(voiced))).toEqual({ state: 'failed', error: 'voice worker crashed' })
    expect(calls.clean).toBe(1)
    failing = false
    stems.reconcile(project({ enabled: false, amount: 1 }))
    await processed(stems, voiced)
    expect(await samplesAt(readyUrl(stems, voiced))).toEqual([0.5, -0.5, 0.25, 0])
    expect(calls.clean).toBe(2)
  })

  test('ready waits for pending stems and names the clip whose cleanup failed', async () => {
    const voiced = project({ enabled: true, amount: 1 })
    const sources = await createVoiceStems(fakeDeps().deps).ready(voiced)
    expect(await samplesAt(sources.get('e-talk'))).toEqual([0.25, -0.25, 0.125, 0])
    const failing = createVoiceStems(
      fakeDeps(async () => {
        throw new Error('voice worker crashed')
      }).deps,
    )
    await expect(failing.ready(voiced)).rejects.toThrow('Clean up voice failed for talk.mp4. voice worker crashed')
  })

  test('settled reports progress, and canceling it keeps a cleanup the project still uses', async () => {
    const stems = createVoiceStems(fakeDeps(() => new Promise(() => {})).deps)
    const voiced = project({ enabled: true, amount: 1 })
    stems.reconcile(voiced)
    const controller = new AbortController()
    const progress: number[] = []
    const waiting = stems.settled([talk(voiced)], { signal: controller.signal, onProgress: (value) => progress.push(value) })
    await Bun.sleep(0)
    controller.abort(new DOMException('Export canceled', 'AbortError'))
    await expect(waiting).rejects.toThrow('Export canceled')
    expect(progress).toEqual([0, 0.5])
    expect(stems.status(talk(voiced)).state).toBe('processing')
  })

  test('releases the stem and revokes its URLs once no clip uses it, and reloads the saved stem later', async () => {
    const { deps, calls } = fakeDeps()
    const stems = createVoiceStems(deps)
    const half = project({ enabled: true, amount: 0.5 })
    await processed(stems, half)
    const wetUrl = readyUrl(stems, half)
    const mixUrl = stems.audioSources(half).get('e-talk')
    expect(await samplesAt(wetUrl)).toEqual([0.25, -0.25, 0.125, 0])
    expect(await samplesAt(mixUrl)).toEqual([0.375, -0.375, 0.1875, 0])
    stems.reconcile(withoutClips(half))
    expect(stems.status(talk(half))).toEqual({ state: 'idle' })
    expect([...stems.get().keys()]).toEqual([])
    await expect(samplesAt(wetUrl)).rejects.toThrow()
    await expect(samplesAt(mixUrl)).rejects.toThrow()
    await processed(stems, half)
    expect(await samplesAt(stems.audioSources(half).get('e-talk'))).toEqual([0.375, -0.375, 0.1875, 0])
    expect(calls.clean).toBe(1)
  })

  test('aborts a cleanup in progress when its clip is removed and nothing waits for it', async () => {
    const signals: AbortSignal[] = []
    const stems = createVoiceStems({ ...fakeDeps().deps, clean: stalled(signals) })
    const voiced = project({ enabled: true, amount: 1 })
    stems.reconcile(voiced)
    await Bun.sleep(0)
    stems.reconcile(withoutClips(voiced))
    await Bun.sleep(0)
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
    expect([...stems.get().keys()]).toEqual([])
  })

  test('keeps a cleanup that export waits for after its clip is removed, and aborts it when export is canceled', async () => {
    const signals: AbortSignal[] = []
    const stems = createVoiceStems({ ...fakeDeps().deps, clean: stalled(signals) })
    const voiced = project({ enabled: true, amount: 1 })
    stems.reconcile(voiced)
    const controller = new AbortController()
    const exporting = stems.ready(voiced, { signal: controller.signal })
    await Bun.sleep(0)
    stems.reconcile(withoutClips(voiced))
    expect(stems.status(talk(voiced)).state).toBe('processing')
    expect(signals.map((signal) => signal.aborted)).toEqual([false])
    controller.abort(new DOMException('Export canceled', 'AbortError'))
    await expect(exporting).rejects.toThrow('Export canceled')
    expect(signals.map((signal) => signal.aborted)).toEqual([true])
    expect([...stems.get().keys()]).toEqual([])
  })
})
