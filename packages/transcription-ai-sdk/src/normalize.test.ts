import { describe, expect, test } from 'bun:test'
import { normalizeAISDKResult } from './index'

describe('normalizeAISDKResult', () => {
  test('word-granularity segments become words', () => {
    const result = normalizeAISDKResult({
      text: 'Hello world',
      language: 'en',
      durationInSeconds: 1.5,
      segments: [
        { text: 'Hello', startSecond: 0, endSecond: 0.4 },
        { text: ' world', startSecond: 0.45, endSecond: 0.9 },
      ],
    })
    expect(result.words).toEqual([
      { text: 'Hello', startMs: 0, endMs: 400 },
      { text: 'world', startMs: 450, endMs: 900 },
    ])
    expect(result.segments).toEqual([])
    expect(result.language).toBe('en')
    expect(result.durationMs).toBe(1500)
  })

  test('sentence segments pass through as segments', () => {
    const result = normalizeAISDKResult({
      text: 'Hello world. Bye now.',
      language: undefined,
      durationInSeconds: undefined,
      segments: [
        { text: 'Hello world.', startSecond: 0, endSecond: 1 },
        { text: 'Bye now.', startSecond: 1.2, endSecond: 2 },
      ],
    })
    expect(result.words).toEqual([])
    expect(result.segments).toEqual([
      { text: 'Hello world.', startMs: 0, endMs: 1000 },
      { text: 'Bye now.', startMs: 1200, endMs: 2000 },
    ])
  })

  test('empty segments yield text-only result', () => {
    const result = normalizeAISDKResult({
      text: 'Nothing timed.',
      language: undefined,
      durationInSeconds: 3,
      segments: [],
    })
    expect(result.words).toEqual([])
    expect(result.segments).toEqual([])
    expect(result.durationMs).toBe(3000)
  })
})
