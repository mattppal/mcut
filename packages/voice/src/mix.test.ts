import { describe, expect, test } from 'bun:test'
import { mixVoice } from './mix'

describe('mixVoice', () => {
  const dry = Float32Array.of(1, 0, -0.5, 0.25)
  const wet = Float32Array.of(0, 1, 0.5, 0.25)

  test('blends dry and wet linearly by amount', () => {
    expect([...mixVoice(dry, wet, 0.25)]).toEqual([0.75, 0.25, -0.25, 0.25])
    expect([...mixVoice(dry, wet, 0)]).toEqual([1, 0, -0.5, 0.25])
    expect([...mixVoice(dry, wet, 1)]).toEqual([0, 1, 0.5, 0.25])
  })

  test('rejects stems of different lengths', () => {
    expect(() => mixVoice(dry, wet.subarray(1), 0.5)).toThrow('dry has 4 samples and wet has 3')
  })
})
