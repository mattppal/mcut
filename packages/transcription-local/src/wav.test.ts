import { describe, expect, test } from 'bun:test'
import { parseWav, resampleTo } from './wav'
import { hasSpeech, measureActivity } from './vad'

function pcm16Wav(samples: Float32Array, sampleRate: number, channels = 1): ArrayBuffer {
  const frames = samples.length / channels
  const dataBytes = frames * channels * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const writeAscii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff), true)
  }
  return buffer
}

const sine = (frames: number, sampleRate: number, hz = 440, amplitude = 0.5): Float32Array =>
  Float32Array.from({ length: frames }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate))

describe('parseWav', () => {
  test('decodes mono PCM16', () => {
    const source = sine(16_000, 16_000)
    const decoded = parseWav(pcm16Wav(source, 16_000))!
    expect(decoded.sampleRate).toBe(16_000)
    expect(decoded.samples.length).toBe(16_000)
    expect(decoded.samples[100]!).toBeCloseTo(source[100]!, 2)
  })

  test('downmixes stereo to mono', () => {
    const stereo = new Float32Array(200)
    for (let i = 0; i < 100; i++) {
      stereo[i * 2] = 0.5
      stereo[i * 2 + 1] = -0.5
    }
    const decoded = parseWav(pcm16Wav(stereo, 44_100, 2))!
    expect(decoded.samples.length).toBe(100)
    expect(Math.abs(decoded.samples[50]!)).toBeLessThan(0.01)
  })

  test('rejects non-WAV bytes', () => {
    expect(parseWav(new ArrayBuffer(10))).toBeNull()
    expect(parseWav(new Uint8Array(64).fill(65).buffer)).toBeNull()
  })
})

describe('resampleTo', () => {
  test('halves the length 32k → 16k', () => {
    const out = resampleTo({ samples: sine(32_000, 32_000), sampleRate: 32_000 }, 16_000)
    expect(out.length).toBe(16_000)
  })

  test('same-rate passthrough', () => {
    const samples = sine(100, 16_000)
    expect(resampleTo({ samples, sampleRate: 16_000 }, 16_000)).toBe(samples)
  })
})

describe('vad', () => {
  test('a tone counts as speechful', () => {
    expect(hasSpeech(sine(16_000, 16_000), 16_000)).toBe(true)
  })

  test('silence does not', () => {
    expect(hasSpeech(new Float32Array(16_000), 16_000)).toBe(false)
  })

  test('near-silence with a tiny click does not', () => {
    const samples = new Float32Array(16_000)
    samples[8000] = 0.004
    expect(hasSpeech(samples, 16_000)).toBe(false)
  })

  test('activity measurement reports fractions', () => {
    const half = sine(16_000, 16_000)
    half.fill(0, 8000)
    const activity = measureActivity(half, 16_000)
    expect(activity.activeFraction).toBeGreaterThan(0.4)
    expect(activity.activeFraction).toBeLessThan(0.6)
  })
})
