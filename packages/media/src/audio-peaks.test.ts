import { describe, expect, test } from 'bun:test'
import { bucketPeaks } from './audio-peaks'

describe('bucketPeaks', () => {
  test('folds samples into max-amplitude buckets', () => {
    const samples = new Float32Array([0.1, -0.9, 0.2, 0.3, -0.05, 0.5])
    const peaks = bucketPeaks(samples, 3)
    expect(peaks.length).toBe(3)
    expect(peaks[0]).toBeCloseTo(0.9)
    expect(peaks[1]).toBeCloseTo(0.3)
    expect(peaks[2]).toBeCloseTo(0.5)
  })

  test('handles empty input and clamps bucket count', () => {
    expect([...bucketPeaks(new Float32Array(0), 4)]).toEqual([0, 0, 0, 0])
    expect(bucketPeaks(new Float32Array([0.5]), 0).length).toBe(1)
  })

  test('more buckets than samples leaves trailing buckets empty', () => {
    const peaks = bucketPeaks(new Float32Array([0.4, 0.8]), 4)
    expect(peaks[0]).toBeCloseTo(0.4)
    expect(peaks[2]).toBeCloseTo(0.8)
  })
})
