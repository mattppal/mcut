import { describe, expect, test } from 'bun:test'
import { crossCorrelateEnvelopes } from './audio-sync'

/** Synthetic "speech" envelope: bursts at known positions over noise. */
function envelope(length: number, bursts: number[], seedNoise = 0.02): Float32Array {
  const env = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    // Deterministic pseudo-noise (no Math.random in tests).
    env[i] = seedNoise * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1)
  }
  for (const at of bursts) {
    for (let i = 0; i < 12; i++) {
      if (at + i < length) env[at + i]! += Math.exp(-i / 4)
    }
  }
  return env
}

describe('crossCorrelateEnvelopes', () => {
  test('recovers a known shift (B started earlier → content later in B)', () => {
    const bursts = [50, 230, 410, 620, 800]
    const a = envelope(1000, bursts)
    const shift = 137
    const b = envelope(1200, bursts.map((x) => x + shift))
    const { lag, confidence } = crossCorrelateEnvelopes(a, b, 300)
    expect(lag).toBe(shift)
    expect(confidence).toBeGreaterThan(1.3)
  })

  test('recovers a negative shift', () => {
    const bursts = [300, 470, 650, 840]
    const a = envelope(1000, bursts)
    const b = envelope(1000, bursts.map((x) => x - 90))
    const { lag } = crossCorrelateEnvelopes(a, b, 300)
    expect(lag).toBe(-90)
  })

  test('uncorrelated audio reports low confidence', () => {
    const a = envelope(1000, [100, 300, 500])
    const b = envelope(1000, [173, 411, 766, 912])
    const { confidence } = crossCorrelateEnvelopes(a, b, 300)
    expect(confidence).toBeLessThan(1.3)
  })
})
