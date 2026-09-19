import type { TranscriptResult } from '@mcut/transcription'

interface SampleWord {
  text: string
  startMs: number
  endMs: number
}

const SAMPLE_WORD_BASE_MS = 120
const SAMPLE_WORD_PER_CHAR_MS = 40
const SAMPLE_WORD_GAP_MS = 140

function words(groups: Array<{ atMs: number; text: string }>): SampleWord[] {
  const result: SampleWord[] = []
  for (const group of groups) {
    let cursor = group.atMs
    for (const text of group.text.split(' ')) {
      const duration = SAMPLE_WORD_BASE_MS + text.length * SAMPLE_WORD_PER_CHAR_MS
      result.push({ text, startMs: cursor, endMs: cursor + duration })
      cursor += duration + SAMPLE_WORD_GAP_MS
    }
  }
  return result
}

const WORDS = words([
  { atMs: 1800, text: 'Hey everyone welcome back to the channel' },
  { atMs: 6200, text: 'today we are building a video editor that agents can drive' },
  { atMs: 13900, text: 'every edit is a serializable command with a schema' },
  { atMs: 19600, text: 'so a model can cut trim caption and animate without touching the UI' },
  { atMs: 27800, text: 'let me show you what that looks like' },
])

export const SAMPLE_TRANSCRIPT: TranscriptResult = {
  text: WORDS.map((word) => word.text).join(' '),
  language: 'en',
  durationMs: 90000,
  words: WORDS,
  segments: [],
}
