import { afterEach, beforeEach, describe, expect, test, setSystemTime } from 'bun:test'
import { EditorEngine, parseProject } from '@mcut/timeline'
import { ensureVoiceStemsForBridge } from './live-mcp-voice-stems'
import { createVoiceStems, type VoiceStemDeps } from './voice-stems'

function engine(): EditorEngine {
  return new EditorEngine({
    project: parseProject({
      id: 'p-voice',
      name: 'Voice',
      width: 1920,
      height: 1080,
      fps: 30,
      assets: {
        'a-talk': { id: 'a-talk', kind: 'video', src: 'blob:talk', hash: 'abc', name: 'talk.mp4', durationMs: 5000, width: 1920, height: 1080 },
        'a-music': { id: 'a-music', kind: 'audio', src: 'blob:music', name: 'music.mp3', durationMs: 5000 },
      },
      tracks: [
        {
          id: 't-video',
          name: 'Video',
          elements: [{ id: 'e-talk', type: 'video', assetId: 'a-talk', startMs: 0, durationMs: 3000, voice: { enabled: true, amount: 1 } }],
        },
        { id: 't-audio', name: 'Audio', elements: [{ id: 'e-music', type: 'audio', assetId: 'a-music', startMs: 0, durationMs: 3000 }] },
      ],
    }),
  })
}

function deps(clean: VoiceStemDeps['clean']): VoiceStemDeps {
  return {
    decode: async () => Float32Array.from([0.5, -0.5]),
    clean,
    load: async () => null,
    save: async () => {},
  }
}

const halve: VoiceStemDeps['clean'] = async (samples) => samples.map((sample) => sample / 2)

beforeEach(() => setSystemTime(new Date('2026-09-25T12:00:00Z')))
afterEach(() => setSystemTime())

describe('ensureVoiceStemsForBridge', () => {
  test('waits for every clip with Clean up voice on and reports its stem ready', async () => {
    const result = await ensureVoiceStemsForBridge(engine(), {}, createVoiceStems(deps(halve)))
    expect(result).toEqual({ elements: [{ id: 'e-talk', assetId: 'a-talk', status: 'ready', processingMs: 0 }] })
  })

  test('without wait it reports progress at once, and a second call joins the same run', async () => {
    let release = (): void => {}
    let runs = 0
    const stems = createVoiceStems(
      deps(async (samples) => {
        runs++
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return halve(samples, () => {})
      }),
    )
    const editor = engine()
    expect(await ensureVoiceStemsForBridge(editor, { wait: false }, stems)).toEqual({
      elements: [{ id: 'e-talk', assetId: 'a-talk', status: 'processing', progress: 0 }],
    })
    const waited = ensureVoiceStemsForBridge(editor, { elementIds: ['e-talk'] }, stems)
    await Bun.sleep(0)
    release()
    expect(await waited).toEqual({ elements: [{ id: 'e-talk', assetId: 'a-talk', status: 'ready', processingMs: 0 }] })
    expect(runs).toBe(1)
  })

  test('reports a failed stem with its error and retries it when asked again', async () => {
    let attempts = 0
    const stems = createVoiceStems(
      deps(async (samples, onProgress) => {
        attempts++
        if (attempts === 1) throw new Error('The voice model crashed.')
        return halve(samples, onProgress)
      }),
    )
    const editor = engine()
    expect(await ensureVoiceStemsForBridge(editor, {}, stems)).toEqual({
      elements: [{ id: 'e-talk', assetId: 'a-talk', status: 'failed', error: 'The voice model crashed.' }],
    })
    expect(await ensureVoiceStemsForBridge(editor, {}, stems)).toEqual({
      elements: [{ id: 'e-talk', assetId: 'a-talk', status: 'ready', processingMs: 0 }],
    })
  })

  test('rejects a named clip without Clean up voice and a clip that does not exist', async () => {
    const stems = createVoiceStems(deps(halve))
    const editor = engine()
    await expect(ensureVoiceStemsForBridge(editor, { elementIds: ['e-music'] }, stems)).rejects.toThrow(
      'Clip "e-music" does not have Clean up voice on. Turn it on with updateElement or the audio.cleanVoice operator first.',
    )
    await expect(ensureVoiceStemsForBridge(editor, { elementIds: ['e-ghost'] }, stems)).rejects.toThrow('No clip "e-ghost" in the project.')
  })
})
