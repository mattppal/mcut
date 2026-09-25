import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject } from '@mcut/timeline'
import { z } from 'zod'
import { handleGetAudioActivity } from './live-mcp-bridge'

const activityResultSchema = z.object({
  elementId: z.string(),
  asset: z.object({ id: z.string() }),
  source: z.object({
    startMs: z.number(),
    endMs: z.number(),
    elementSourceStartMs: z.number(),
    elementSourceEndMs: z.number(),
  }),
  soundWindows: z.array(z.object({ startMs: z.number(), endMs: z.number() })),
})

describe('multicam audio activity', () => {
  test('analyzes a multicam through its offset audio source', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const trackId = engine.project.tracks[0]?.id
    if (!trackId) throw new Error('missing track')
    engine.dispatch({ type: 'addTrack', id: 't-mic' })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 60000 } })
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'blob:mic', name: 'mic.wav', durationMs: 60000 } })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 4000, trimStartMs: 0 },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-mic',
      element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 0, durationMs: 4000, trimStartMs: 250 },
    })
    engine.dispatch({
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }],
      multicamId: 'e-mc',
    })

    const result = activityResultSchema.parse(
      await handleGetAudioActivity(engine, { elementId: 'e-mc' }, async (src, options) => {
        expect(src).toBe('blob:mic')
        expect(options).toMatchObject({ startMs: 250, endMs: 4250 })
        return {
          durationMs: 4000,
          soundWindows: [{ startMs: 0, endMs: 100, durationMs: 100, rms: 0.02, peakRms: 0.03, peakAmplitude: 0.4 }],
          silenceWindows: [{ startMs: 100, endMs: 4000, durationMs: 3900, rms: 0, peakRms: 0, peakAmplitude: 0 }],
          summary: { soundMs: 100, silenceMs: 3900, soundFraction: 0.025, silenceFraction: 0.975, peakRms: 0.03, peakAmplitude: 0.4 },
        }
      }),
    )

    expect(result.elementId).toBe('e-mc')
    expect(result.asset.id).toBe('a-mic')
    expect(result.source).toEqual({ startMs: 250, endMs: 4250, elementSourceStartMs: 250, elementSourceEndMs: 4250 })
    expect(result.soundWindows.map((window) => ({ startMs: window.startMs, endMs: window.endMs }))).toEqual([{ startMs: 250, endMs: 350 }])
  })
})
