import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject } from '@mcut/timeline'
import { buildApplyCaptionsCommand, groupWords, toCaptionElements } from './captions'
import { toSrt, toVtt } from './subtitles'
import type { TranscriptResult, TranscriptWord } from './types'

const words: TranscriptWord[] = [
  { text: 'Hello', startMs: 0, endMs: 400 },
  { text: 'world,', startMs: 450, endMs: 800 },
  { text: 'this', startMs: 900, endMs: 1100 },
  { text: 'is', startMs: 1150, endMs: 1250 },
  { text: 'mcut.', startMs: 1300, endMs: 1700 },
  // 2s silence gap → new caption
  { text: 'Second', startMs: 3700, endMs: 4100 },
  { text: 'caption.', startMs: 4150, endMs: 4600 },
]

const result: TranscriptResult = {
  text: 'Hello world, this is mcut. Second caption.',
  language: 'en',
  durationMs: 5000,
  words,
  segments: [],
}

describe('groupWords', () => {
  test('splits on silence gaps', () => {
    const groups = groupWords(words)
    expect(groups.map((g) => g.text)).toEqual([
      'Hello world, this is mcut.',
      'Second caption.',
    ])
    expect(groups[0]).toMatchObject({ startMs: 0, endMs: 1700 })
    expect(groups[1]).toMatchObject({ startMs: 3700, endMs: 4600 })
  })

  test('splits on character budget', () => {
    const groups = groupWords(words, { maxChars: 12 })
    expect(groups.map((g) => g.text)).toEqual([
      'Hello world,',
      'this is',
      'mcut.',
      'Second',
      'caption.',
    ])
  })

  test('splits on speaker change', () => {
    const speakers: TranscriptWord[] = [
      { text: 'Hi', startMs: 0, endMs: 200, speaker: 'A' },
      { text: 'there', startMs: 250, endMs: 500, speaker: 'A' },
      { text: 'Hey', startMs: 550, endMs: 700, speaker: 'B' },
    ]
    expect(groupWords(speakers).map((g) => g.text)).toEqual(['Hi there', 'Hey'])
  })
})

describe('toCaptionElements', () => {
  test('produces relative word timings and dispatches cleanly', () => {
    const elements = toCaptionElements(result)
    expect(elements).toHaveLength(2)
    expect(elements[0]).toMatchObject({ startMs: 0, durationMs: 1700 })
    expect(elements[1]).toMatchObject({ startMs: 3700, durationMs: 900 })
    expect(elements[1]!.words![0]).toEqual({ text: 'Second', startMs: 0, endMs: 400 })

    const project = createProject()
    const next = applyCommand(project, buildApplyCaptionsCommand(result))
    const captionTrack = next.tracks.find((t) => t.name === 'Captions')!
    expect(captionTrack.elements).toHaveLength(2)
    expect(captionTrack.elements.every((e) => e.type === 'caption')).toBe(true)
  })

  test('clamps overlapping groups to keep the track invariant', () => {
    const overlapping: TranscriptResult = {
      text: 'a b',
      words: [],
      segments: [
        { text: 'a', startMs: 0, endMs: 1000 },
        { text: 'b', startMs: 500, endMs: 1500 }, // overlaps previous
      ],
    }
    const elements = toCaptionElements(overlapping)
    expect(elements[0]).toMatchObject({ startMs: 0, durationMs: 1000 })
    expect(elements[1]).toMatchObject({ startMs: 1000, durationMs: 500 })
    const project = createProject()
    expect(() => applyCommand(project, buildApplyCaptionsCommand(overlapping))).not.toThrow()
  })

  test('falls back to a single caption when only text is available', () => {
    const bare: TranscriptResult = { text: 'Just text.', words: [], segments: [], durationMs: 3000 }
    expect(toCaptionElements(bare)).toEqual([
      { type: 'caption', startMs: 0, durationMs: 3000, text: 'Just text.' },
    ])
  })

  test('offsets captions to the timeline clip start', () => {
    const elements = toCaptionElements(result, { timeOffsetMs: 10_000 })
    expect(elements[0]).toMatchObject({ startMs: 10_000, durationMs: 1700 })
    expect(elements[1]).toMatchObject({ startMs: 13_700, durationMs: 900 })
    expect(elements[1]!.words![0]).toEqual({ text: 'Second', startMs: 0, endMs: 400 })
  })

  test('clips captions to a trimmed source range before offsetting', () => {
    const elements = toCaptionElements(result, {
      sourceStartMs: 1_000,
      sourceEndMs: 4_000,
      timeOffsetMs: 20_000,
    })
    expect(elements.map((element) => element.text)).toEqual(['this is mcut.', 'Second'])
    expect(elements[0]).toMatchObject({ startMs: 20_000, durationMs: 700 })
    expect(elements[0]!.words![0]).toEqual({ text: 'this', startMs: 0, endMs: 100 })
    expect(elements[1]).toMatchObject({ startMs: 22_700, durationMs: 300 })
  })
})

describe('subtitles', () => {
  test('toSrt golden output', () => {
    expect(toSrt(result)).toBe(
      `1
00:00:00,000 --> 00:00:01,700
Hello world, this is mcut.

2
00:00:03,700 --> 00:00:04,600
Second caption.
`,
    )
  })

  test('toVtt golden output', () => {
    expect(toVtt(result)).toBe(
      `WEBVTT

00:00:00.000 --> 00:00:01.700
Hello world, this is mcut.

00:00:03.700 --> 00:00:04.600
Second caption.
`,
    )
  })

  test('hour-scale timestamps', () => {
    const long: TranscriptResult = {
      text: 'late',
      words: [],
      segments: [{ text: 'late', startMs: 3_661_250, endMs: 3_662_000 }],
    }
    expect(toSrt(long)).toContain('01:01:01,250 --> 01:01:02,000')
  })
})
