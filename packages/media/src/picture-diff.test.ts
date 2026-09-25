import { describe, expect, test } from 'bun:test'
import { changedFraction, lumaSignature, segmentsBetween, thresholdFor } from './picture-diff'

const flat = (value: number, cells = 100) => new Uint8Array(cells).fill(value)

describe('picture diff', () => {
  test('lumaSignature weights green over red over blue', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
    const [red = 0, green = 0, blue = 0] = lumaSignature(rgba)
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  test('changedFraction counts cells that move past the noise floor', () => {
    const page = flat(40)
    const nextPage = page.map((value, i) => (i < 70 ? 220 : value))
    const noisy = page.map((value, i) => (i % 2 === 0 ? value + 10 : value))
    expect(changedFraction(page, nextPage)).toBeCloseTo(0.7)
    expect(changedFraction(page, noisy)).toBe(0)
  })

  test('a new page passes the default threshold and a small scroll does not', () => {
    const page = flat(40)
    const scrolled = page.map((value, i) => (i < 15 ? 200 : value))
    const nextPage = page.map((value, i) => (i < 80 ? 200 : value))
    expect(changedFraction(page, scrolled)).toBeLessThan(thresholdFor(0.5))
    expect(changedFraction(page, nextPage)).toBeGreaterThanOrEqual(thresholdFor(0.5))
    expect(thresholdFor(1)).toBeLessThan(thresholdFor(0.5))
  })

  test('segmentsBetween splits the range at each change inside it', () => {
    const changes = [
      { timeMs: 45_000, changed: 0.87 },
      { timeMs: 99_300, changed: 0.89 },
      { timeMs: 200_000, changed: 0.5 },
    ]
    expect(segmentsBetween(0, 120_000, changes)).toEqual([
      { startMs: 0, endMs: 45_000 },
      { startMs: 45_000, endMs: 99_300 },
      { startMs: 99_300, endMs: 120_000 },
    ])
  })
})
