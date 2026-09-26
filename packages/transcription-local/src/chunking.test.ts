import { describe, expect, test } from 'bun:test'
import { MIN_OVERLAP_PAUSE_MS, mergeChunkSegments, mergeChunkWords, planChunks, segmentsFromWords } from './chunking'
import type { TranscriptSegment, TranscriptWord } from '@mcut/transcription'

const word = (text: string, startMs: number, endMs: number): TranscriptWord => ({
  text,
  startMs,
  endMs,
})

const segment = (text: string, startMs: number, endMs: number): TranscriptSegment => ({
  text,
  startMs,
  endMs,
})

describe('planChunks', () => {
  test('short audio is a single window', () => {
    expect(planChunks(12)).toEqual([{ startS: 0, endS: 12 }])
    expect(planChunks(30)).toEqual([{ startS: 0, endS: 30 }])
  })

  test('long audio gets 30s windows with 5s overlap', () => {
    const chunks = planChunks(70)
    expect(chunks).toEqual([
      { startS: 0, endS: 30 },
      { startS: 25, endS: 55 },
      { startS: 50, endS: 70 },
    ])
  })

  test('no degenerate trailing window', () => {
    const chunks = planChunks(55)
    expect(chunks[chunks.length - 1]).toEqual({ startS: 25, endS: 55 })
  })

  test('empty audio plans nothing', () => {
    expect(planChunks(0)).toEqual([])
  })
})

describe('mergeChunkWords', () => {
  test('single chunk passes through', () => {
    const words = [word('a', 0, 400), word('b', 500, 900)]
    expect(mergeChunkWords([{ chunk: { startS: 0, endS: 30 }, words }])).toEqual(words)
  })

  test('cuts the overlap at the biggest pause in the incoming chunk', () => {
    const merged = mergeChunkWords([
      {
        chunk: { startS: 0, endS: 30 },
        words: [word('one', 24_000, 24_400), word('two', 26_000, 26_400), word('drift', 28_000, 28_300)],
      },
      {
        chunk: { startS: 25, endS: 55 },
        words: [word('two', 26_050, 26_450), word('three', 27_500, 27_900), word('four', 31_000, 31_400)],
      },
    ])
    expect(merged.map((w) => w.text)).toEqual(['one', 'two', 'three', 'four'])
    expect(merged[1]!.startMs).toBe(26_000)
  })

  test(`gaps below ${MIN_OVERLAP_PAUSE_MS}ms cut at the overlap midpoint`, () => {
    const merged = mergeChunkWords([
      {
        chunk: { startS: 0, endS: 30 },
        words: [word('a', 26_000, 26_950), word('b', 27_000, 27_950), word('tail', 28_000, 28_950)],
      },
      {
        chunk: { startS: 25, endS: 55 },
        words: [word('b', 27_010, 27_960), word('tail', 28_010, 28_960), word('next', 29_010, 29_960)],
      },
    ])
    expect(merged.map((w) => w.text)).toEqual(['a', 'b', 'tail', 'next'])
    expect(merged[2]!.startMs).toBe(28_010)
  })

  test('keeps zero-length words on both sides of the cut', () => {
    const merged = mergeChunkWords([
      {
        chunk: { startS: 0, endS: 30 },
        words: [word('before', 26_000, 26_000), word('gap', 26_200, 26_500), word('edge', 29_990, 29_990)],
      },
      {
        chunk: { startS: 25, endS: 55 },
        words: [word('gap', 26_210, 26_510), word('after', 28_000, 28_000), word('later', 31_000, 31_400)],
      },
    ])
    expect(merged.map((w) => w.text)).toEqual(['before', 'gap', 'after', 'later'])
  })

  test('skips empty chunks (VAD-suppressed windows)', () => {
    const merged = mergeChunkWords([
      { chunk: { startS: 0, endS: 30 }, words: [word('hello', 1000, 1400)] },
      { chunk: { startS: 25, endS: 55 }, words: [] },
      { chunk: { startS: 50, endS: 80 }, words: [word('again', 60_000, 60_400)] },
    ])
    expect(merged.map((w) => w.text)).toEqual(['hello', 'again'])
  })
})

describe('segmentsFromWords', () => {
  test('splits at sentence ends, long pauses, and the length cap', () => {
    const words = [
      word('Hi', 0, 200),
      word('there.', 250, 500),
      word('Next', 600, 800),
      word('one', 2000, 2200),
      ...Array.from({ length: 12 }, (_, i) => word(`w${i}`, 3000 + i * 1000, 3500 + i * 1000)),
    ]
    const segments = segmentsFromWords(words)
    expect(segments.map((s) => s.text.split(' ')[0])).toEqual(['Hi', 'Next', 'one', 'w9'])
    expect(segments[0]).toEqual({ text: 'Hi there.', startMs: 0, endMs: 500 })
    expect(segments.every((s) => s.endMs - s.startMs <= 10_000)).toBe(true)
  })
})

describe('mergeChunkSegments', () => {
  test('single chunk passes through', () => {
    const segments = [segment('hello there', 0, 1600)]
    expect(mergeChunkSegments([{ chunk: { startS: 0, endS: 30 }, segments }])).toEqual(segments)
  })

  test('cuts overlapped segment transcripts without duplicating the overlap', () => {
    const merged = mergeChunkSegments([
      {
        chunk: { startS: 0, endS: 30 },
        segments: [segment('one', 24_000, 24_800), segment('two', 26_000, 26_700), segment('drift', 28_000, 28_600)],
      },
      {
        chunk: { startS: 25, endS: 55 },
        segments: [segment('two', 26_050, 26_750), segment('three', 27_600, 28_200), segment('four', 31_000, 31_700)],
      },
    ])
    expect(merged.map((s) => s.text)).toEqual(['one', 'two', 'three', 'four'])
    expect(merged[1]!.startMs).toBe(26_000)
  })
})
