import { describe, expect, test } from 'bun:test'
import { makeConstantSpeedMap } from '@mcut/timeline'
import { constantSpeedOf, stretchStereo } from './time-stretch'

describe('constantSpeedOf', () => {
  test('recognizes setElementSpeed maps', () => {
    const constant = constantSpeedOf(makeConstantSpeedMap(2000, 2))
    expect(constant).toEqual({ rate: 2, sourceStartOffsetMs: 0, sourceSpanMs: 4000 })
  })

  test('recognizes split right-halves (non-zero start value)', () => {
    const constant = constantSpeedOf([
      { timeMs: 0, value: 1000 },
      { timeMs: 1500, value: 4000 },
    ])
    expect(constant).toEqual({ rate: 2, sourceStartOffsetMs: 1000, sourceSpanMs: 3000 })
  })

  test('rejects ramps, freezes, and missing maps', () => {
    expect(constantSpeedOf(undefined)).toBeNull()
    expect(
      constantSpeedOf([
        { timeMs: 0, value: 0, easing: 'easeInOut' },
        { timeMs: 1000, value: 2000 },
      ]),
    ).toBeNull()
    expect(
      constantSpeedOf([
        { timeMs: 0, value: 0 },
        { timeMs: 500, value: 1000 },
        { timeMs: 1000, value: 1000 },
      ]),
    ).toBeNull()
    expect(
      constantSpeedOf([
        { timeMs: 0, value: 0 },
        { timeMs: 1000, value: 0 }, // pure freeze
      ]),
    ).toBeNull()
  })
})

describe('stretchStereo', () => {
  function sine(frames: number, sampleRate: number, hz: number): Float32Array {
    const data = new Float32Array(frames)
    for (let i = 0; i < frames; i++) data[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate)
    return data
  }

  // Bun has no OfflineAudioContext, so these exercise the WSOLA fallback
  // path; the Signalsmith worklet path is covered by the browser repro.
  test('tempo 2 halves the duration (±10%), preserving content energy', async () => {
    const sampleRate = 44_100
    const input = sine(sampleRate * 2, sampleRate, 440) // 2s of 440Hz
    const { left, right } = await stretchStereo({ left: input, right: input, sampleRate }, 2)
    expect(left.length).toBe(right.length)
    expect(left.length).toBeGreaterThan(sampleRate * 0.9)
    expect(left.length).toBeLessThan(sampleRate * 1.1)
    // The stretched signal is still a real waveform, not silence.
    let energy = 0
    for (const v of left) energy += v * v
    expect(energy / left.length).toBeGreaterThan(0.1)
  })

  test('tempo 0.5 doubles the duration (±10%)', async () => {
    const sampleRate = 44_100
    const input = sine(sampleRate, sampleRate, 220) // 1s
    const { left } = await stretchStereo({ left: input, right: input, sampleRate }, 0.5)
    expect(left.length).toBeGreaterThan(sampleRate * 1.8)
    expect(left.length).toBeLessThan(sampleRate * 2.2)
  })
})
