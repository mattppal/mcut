import { describe, expect, test } from 'bun:test'
import { analyzeAudioSamples } from './audio-activity'

const sampleRate = 1000

function samples(values: Array<{ ms: number; value: number }>): Float32Array {
  return Float32Array.from(values.flatMap(({ ms, value }) => Array.from({ length: ms }, () => value)))
}

describe('analyzeAudioSamples', () => {
  test('pure silence produces one silence window', () => {
    const activity = analyzeAudioSamples(samples([{ ms: 1000, value: 0 }]), sampleRate)

    expect(activity.durationMs).toBe(1000)
    expect(activity.soundWindows).toEqual([])
    expect(activity.silenceWindows).toEqual([
      expect.objectContaining({ startMs: 0, endMs: 1000, durationMs: 1000 }),
    ])
    expect(activity.summary.soundMs).toBe(0)
    expect(activity.summary.silenceMs).toBe(1000)
  })

  test('continuous tone produces one sound window', () => {
    const activity = analyzeAudioSamples(samples([{ ms: 1000, value: 0.02 }]), sampleRate)

    expect(activity.soundWindows).toEqual([
      expect.objectContaining({ startMs: 0, endMs: 1000, durationMs: 1000 }),
    ])
    expect(activity.silenceWindows).toEqual([])
    expect(activity.summary.soundMs).toBe(1000)
    expect(activity.summary.peakRms).toBe(0.02)
    expect(activity.summary.peakAmplitude).toBe(0.02)
  })

  test('sound-silence-sound splits correctly', () => {
    const activity = analyzeAudioSamples(
      samples([
        { ms: 300, value: 0.02 },
        { ms: 300, value: 0 },
        { ms: 400, value: 0.02 },
      ]),
      sampleRate,
    )

    expect(activity.soundWindows.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 300],
      [600, 1000],
    ])
    expect(activity.silenceWindows.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[300, 600]])
  })

  test('short gaps and fragments merge according to defaults', () => {
    const activity = analyzeAudioSamples(
      samples([
        { ms: 300, value: 0.02 },
        { ms: 60, value: 0 },
        { ms: 300, value: 0.02 },
        { ms: 60, value: 0.02 },
        { ms: 280, value: 0 },
        { ms: 60, value: 0.02 },
        { ms: 280, value: 0 },
      ]),
      sampleRate,
    )

    expect(activity.soundWindows.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0, 720]])
    expect(activity.silenceWindows.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[720, 1340]])
  })

  test('optional waveform buckets are bounded and compact', () => {
    const activity = analyzeAudioSamples(
      Float32Array.from([-1, -0.5, 0, 0.25, 0.75, 1]),
      sampleRate,
      { waveformBuckets: 3 },
    )

    expect(activity.waveform).toHaveLength(3)
    expect(activity.waveform!.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(activity.waveform).toEqual([1, 0.25, 1])
  })
})
