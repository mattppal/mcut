import { describe, expect, test } from 'bun:test'
import { parseProject, type Project, type Voice } from '@mcut/timeline'
import { decodeWav, encodeWav } from '@mcut/voice'
import { createVoiceStems, type VoiceStemDeps, type VoiceStems } from './voice-stems'

function project(voice?: Voice): Project {
  return parseProject({
    id: 'p-voice',
    name: 'Voice',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      'a-talk': { id: 'a-talk', kind: 'video', src: 'blob:talk', hash: 'abc', name: 'talk.mp4', durationMs: 5000, width: 1920, height: 1080 },
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
  await stems.settled(['a-talk'])
}

function readyUrl(stems: VoiceStems): string {
  const stem = stems.status('a-talk')
  if (stem.state !== 'ready') throw new Error(`stem is ${stem.state}`)
  return stem.url
}

describe('voice stems', () => {
  test('cleans a clip when its voice turns on and plays the wet stem at full amount', async () => {
    const { deps, calls } = fakeDeps()
    const stems = createVoiceStems(deps)
    const voiced = project({ enabled: true, amount: 1 })
    stems.reconcile(voiced)
    expect(stems.status('a-talk').state).toBe('processing')
    await stems.settled(['a-talk'])
    stems.reconcile(voiced)
    expect(stems.audioSources(voiced).get('e-talk')).toBe(readyUrl(stems))
    expect(await samplesAt(readyUrl(stems))).toEqual([0.25, -0.25, 0.125, 0])
    expect(calls.clean).toBe(1)
  })

  test('leaves clips without voice on their own audio', () => {
    const { deps, calls } = fakeDeps()
    const stems = createVoiceStems(deps)
    const off = project({ enabled: false, amount: 1 })
    stems.reconcile(off)
    expect(stems.status('a-talk')).toEqual({ state: 'idle' })
    expect([...stems.audioSources(off)]).toEqual([])
    expect(calls.clean).toBe(0)
  })

  test('reuses the stem saved by an earlier session instead of cleaning again', async () => {
    const { deps, saved, calls } = fakeDeps()
    await processed(createVoiceStems(deps), project({ enabled: true, amount: 1 }))
    const nextSession = createVoiceStems(deps)
    await processed(nextSession, project({ enabled: true, amount: 1 }))
    expect([...saved.keys()]).toEqual(['voice-dfn3-cli-thresholds-1-abc.wav'])
    expect(await samplesAt(readyUrl(nextSession))).toEqual([0.25, -0.25, 0.125, 0])
    expect(calls.clean).toBe(1)
  })

  test('cleans again when the saved stem does not match the decoded audio', async () => {
    const { deps, saved, calls } = fakeDeps()
    saved.set('voice-dfn3-cli-thresholds-1-abc.wav', new Blob([encodeWav(Float32Array.from([0.1]), 48_000)]))
    const stems = createVoiceStems(deps)
    await processed(stems, project({ enabled: true, amount: 1 }))
    expect(await samplesAt(readyUrl(stems))).toEqual([0.25, -0.25, 0.125, 0])
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
    expect(stems.status('a-talk')).toEqual({ state: 'failed', error: 'voice worker crashed' })
    expect(calls.clean).toBe(1)
    failing = false
    stems.reconcile(project({ enabled: false, amount: 1 }))
    await processed(stems, voiced)
    expect(await samplesAt(readyUrl(stems))).toEqual([0.5, -0.5, 0.25, 0])
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

  test('settled reports progress and rejects when its signal aborts', async () => {
    const stems = createVoiceStems(fakeDeps(() => new Promise(() => {})).deps)
    stems.reconcile(project({ enabled: true, amount: 1 }))
    const controller = new AbortController()
    const progress: number[] = []
    const waiting = stems.settled(['a-talk'], { signal: controller.signal, onProgress: (value) => progress.push(value) })
    await Bun.sleep(0)
    controller.abort(new DOMException('Export canceled', 'AbortError'))
    await expect(waiting).rejects.toThrow('Export canceled')
    expect(progress).toEqual([0, 0.5])
  })
})
