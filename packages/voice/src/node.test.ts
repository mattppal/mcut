import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { cleanVoice, decodeWav } from './node'

const fixture = (name: string) => decodeWav(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url))).samples
const input = fixture('input.wav')

function signalToDifferenceDb(estimate: Float32Array, reference: Float32Array): number {
  let signal = 0
  let difference = 0
  reference.forEach((sample, index) => {
    signal += sample * sample
    difference += (sample - (estimate[index] ?? 0)) ** 2
  })
  return 10 * Math.log10(signal / difference)
}

describe('cleanVoice on Node workers', () => {
  test('matches the native deep-filter CLI output', async () => {
    const cleaned = await cleanVoice(input, { workers: 1 })
    expect(cleaned.length).toBe(input.length)
    expect(signalToDifferenceDb(cleaned, fixture('native.wav'))).toBeGreaterThan(60)
  }, 30_000)

  test('matches the single worker output across a chunk seam', async () => {
    const [single, chunked] = await Promise.all([cleanVoice(input, { workers: 1 }), cleanVoice(input, { workers: 2 })])
    expect(signalToDifferenceDb(chunked, single)).toBeGreaterThan(45)
  }, 30_000)

  test('rejects with the abort reason when the signal aborts mid chunk', async () => {
    const controller = new AbortController()
    const cleaning = cleanVoice(input, { workers: 2, signal: controller.signal, onProgress: () => controller.abort(new Error('stopped by the test')) })
    await expect(cleaning).rejects.toThrow('stopped by the test')
  }, 30_000)
})
