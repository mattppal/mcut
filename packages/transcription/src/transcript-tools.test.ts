import { describe, expect, test } from 'bun:test'
import {
  mapCaptionWords,
  mergeCaptions,
  replaceAllMatches,
  replaceMatch,
  retypeWord,
  searchCaptions,
  splitCaptionAtWord,
  type TranscriptCaption,
} from './transcript-tools'

const caption = (
  id: string,
  startMs: number,
  text: string,
  words?: Array<[string, number, number]>,
): TranscriptCaption => ({
  id,
  startMs,
  durationMs: 2000,
  text,
  ...(words ? { words: words.map(([t, s, e]) => ({ text: t, startMs: s, endMs: e })) } : {}),
})

const HELLO = caption('c-1', 1000, 'Hello brave new world', [
  ['Hello', 0, 400],
  ['brave', 500, 900],
  ['new', 1000, 1300],
  ['world', 1400, 1900],
])

describe('mapCaptionWords', () => {
  test('maps words to character ranges in order', () => {
    const mapped = mapCaptionWords(HELLO)!
    expect(mapped.map((m) => [m.startChar, m.endChar])).toEqual([
      [0, 5],
      [6, 11],
      [12, 15],
      [16, 21],
    ])
  })

  test('returns null when words diverge from the text', () => {
    expect(mapCaptionWords(caption('c-x', 0, 'rewritten text', [['Hello', 0, 100]]))).toBeNull()
    expect(mapCaptionWords(caption('c-y', 0, 'no words at all'))).toBeNull()
  })
})

describe('searchCaptions', () => {
  test('finds case-insensitive hits with word-accurate times', () => {
    const hits = searchCaptions([HELLO], 'BRAVE')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      captionId: 'c-1',
      startChar: 6,
      endChar: 11,
      firstWord: 1,
      lastWord: 1,
      timeMs: 1500, // 1000 + 500
      endTimeMs: 1900,
    })
  })

  test('matches phrases across word boundaries', () => {
    const hits = searchCaptions([HELLO], 'brave new')
    expect(hits[0]).toMatchObject({ firstWord: 1, lastWord: 2, timeMs: 1500, endTimeMs: 2300 })
  })

  test('degrades to caption-level time without word mapping', () => {
    const plain = caption('c-2', 5000, 'just some text')
    const hits = searchCaptions([plain], 'some')
    expect(hits[0]).toMatchObject({ timeMs: 5000, endTimeMs: 7000 })
  })

  test('finds repeated hits and sorts by time', () => {
    const a = caption('c-a', 4000, 'tip top tip')
    const b = caption('c-b', 1000, 'the tip')
    const hits = searchCaptions([a, b], 'tip')
    expect(hits.map((h) => h.captionId)).toEqual(['c-b', 'c-a', 'c-a'])
  })

  test('empty query yields nothing', () => {
    expect(searchCaptions([HELLO], '')).toEqual([])
  })
})

describe('replaceMatch', () => {
  test('single-word swap keeps the word timing', () => {
    const [hit] = searchCaptions([HELLO], 'brave')
    const patch = replaceMatch(HELLO, hit!, 'bold')
    expect(patch.text).toBe('Hello bold new world')
    expect(patch.words![1]).toEqual({ text: 'bold', startMs: 500, endMs: 900 })
    expect(patch.words).toHaveLength(4)
  })

  test('multi-word replacement distributes time proportionally', () => {
    const [hit] = searchCaptions([HELLO], 'brave')
    const patch = replaceMatch(HELLO, hit!, 'very bold')
    expect(patch.text).toBe('Hello very bold new world')
    const [, very, bold] = patch.words!
    expect(very).toMatchObject({ text: 'very', startMs: 500 })
    expect(bold).toMatchObject({ text: 'bold', endMs: 900 })
    expect(very!.endMs).toBe(bold!.startMs)
    expect(patch.words).toHaveLength(5)
  })

  test('phrase replacement spans the matched words', () => {
    const [hit] = searchCaptions([HELLO], 'brave new')
    const patch = replaceMatch(HELLO, hit!, 'whole')
    expect(patch.text).toBe('Hello whole world')
    expect(patch.words!.map((w) => w.text)).toEqual(['Hello', 'whole', 'world'])
    expect(patch.words![1]).toMatchObject({ startMs: 500, endMs: 1300 })
  })

  test('partial-word match keeps the rest of the word', () => {
    const [hit] = searchCaptions([HELLO], 'brav')
    const patch = replaceMatch(HELLO, hit!, 'curv')
    expect(patch.text).toBe('Hello curve new world')
    expect(patch.words![1]).toMatchObject({ text: 'curve', startMs: 500, endMs: 900 })
  })

  test('deleting a word removes it from the words too', () => {
    const [hit] = searchCaptions([HELLO], 'brave ')
    const patch = replaceMatch(HELLO, hit!, '')
    expect(patch.text).toBe('Hello new world')
    expect(patch.words!.map((w) => w.text)).toEqual(['Hello', 'new', 'world'])
  })
})

describe('replaceAllMatches', () => {
  test('replaces every occurrence across captions', () => {
    const a = caption('c-a', 0, 'acme makes acme tools', [
      ['acme', 0, 200],
      ['makes', 300, 500],
      ['acme', 600, 800],
      ['tools', 900, 1100],
    ])
    const b = caption('c-b', 3000, 'nothing here')
    const patches = replaceAllMatches([a, b], 'acme', 'Acme Corp')
    expect(patches).toHaveLength(1)
    expect(patches[0]!.text).toBe('Acme Corp makes Acme Corp tools')
    expect(patches[0]!.words!.map((w) => w.text)).toEqual([
      'Acme',
      'Corp',
      'makes',
      'Acme',
      'Corp',
      'tools',
    ])
    // Timings stay inside the original spans.
    expect(patches[0]!.words![0]).toMatchObject({ startMs: 0 })
    expect(patches[0]!.words![1]).toMatchObject({ endMs: 200 })
  })

  test('caption without word timings gets a plain text patch', () => {
    const plain = caption('c-p', 0, 'foo and foo')
    const patches = replaceAllMatches([plain], 'foo', 'bar')
    expect(patches[0]).toEqual({ captionId: 'c-p', text: 'bar and bar' })
  })
})

describe('retypeWord', () => {
  test('fixes one word in place', () => {
    const patch = retypeWord(HELLO, 2, 'knew')!
    expect(patch.text).toBe('Hello brave knew world')
    expect(patch.words![2]).toEqual({ text: 'knew', startMs: 1000, endMs: 1300 })
  })

  test('returns null without word mapping', () => {
    expect(retypeWord(caption('c-p', 0, 'plain'), 0, 'x')).toBeNull()
  })
})

describe('splitCaptionAtWord', () => {
  test('splits before the word at its start time', () => {
    const result = splitCaptionAtWord(HELLO, 2)!
    expect(result.left).toMatchObject({ text: 'Hello brave', durationMs: 1000 })
    expect(result.left.words.map((w) => w.text)).toEqual(['Hello', 'brave'])
    expect(result.right).toMatchObject({ startMs: 2000, durationMs: 1000, text: 'new world' })
    expect(result.right.words[0]).toEqual({ text: 'new', startMs: 0, endMs: 300 })
    expect(result.right.words[1]).toEqual({ text: 'world', startMs: 400, endMs: 900 })
  })

  test('rejects edge indices and unmapped captions', () => {
    expect(splitCaptionAtWord(HELLO, 0)).toBeNull()
    expect(splitCaptionAtWord(HELLO, 4)).toBeNull()
    expect(splitCaptionAtWord(caption('c-p', 0, 'plain text'), 1)).toBeNull()
  })
})

describe('mergeCaptions', () => {
  test('merges adjacent captions, rebasing the later words', () => {
    const a = caption('c-a', 1000, 'Hello there', [
      ['Hello', 0, 400],
      ['there', 500, 900],
    ])
    const b = caption('c-b', 3000, 'old friend', [
      ['old', 0, 300],
      ['friend', 400, 800],
    ])
    const merged = mergeCaptions(b, a) // order-independent
    expect(merged).toMatchObject({ startMs: 1000, durationMs: 4000, text: 'Hello there old friend' })
    expect(merged.words!.map((w) => w.startMs)).toEqual([0, 500, 2000, 2400])
  })

  test('drops words when either side lacks them', () => {
    const a = caption('c-a', 0, 'Hello')
    const b = caption('c-b', 2000, 'world', [['world', 0, 500]])
    expect(mergeCaptions(a, b).words).toBeUndefined()
  })
})
