import type { TranscriptResult } from '@mcut/transcription'

/**
 * A fake voiceover for the talking-head template's 90s camera clip: ~30s of
 * speech with deliberate dead air — leading silence before the first word,
 * a long pause mid-way, and trailing room tone — so the captions and
 * silence-cut recipes have something real to chew on.
 */
function words(
  groups: Array<{ atMs: number; text: string }>,
): TranscriptResult['words'] {
  const result: TranscriptResult['words'] = []
  for (const group of groups) {
    let cursor = group.atMs
    for (const text of group.text.split(' ')) {
      const duration = 120 + text.length * 40
      result.push({ text, startMs: cursor, endMs: cursor + duration })
      cursor += duration + 140
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
