import { describe, expect, test } from 'bun:test'
import { correctCaptions, correctWords, retypeCaption } from './transcript-corrections'
import { mapCaptionWords, type TranscriptCaption } from './transcript-tools'

type Spoken = Array<[string, number, number]>

const timed = (words: Spoken) => words.map(([text, startMs, endMs]) => ({ text, startMs, endMs }))

const caption = (id: string, startMs: number, words: Spoken, durationMs = 3000): TranscriptCaption => ({
  id,
  startMs,
  durationMs,
  text: words.map(([text]) => text).join(' '),
  words: timed(words),
})

const MISHEARD_WORDS = timed([
  ['I', 0, 100],
  ['asked', 150, 400],
  ['Grok', 450, 700],
  ['Bot,', 750, 1000],
  ['and', 1100, 1200],
  ['grok', 1250, 1500],
  ['bot', 1550, 1800],
  ['answered.', 1850, 2300],
])

const MISHEARD: TranscriptCaption = {
  id: 'c-1',
  startMs: 1000,
  durationMs: 3000,
  text: MISHEARD_WORDS.map((word) => word.text).join(' '),
  words: MISHEARD_WORDS,
}

describe('correctCaptions', () => {
  test('merges a misheard two-word name into one word that spans both timings, keeping punctuation', () => {
    const { patches, count } = correctCaptions([MISHEARD], 'grok bot', 'Grokbot')
    expect(count).toBe(2)
    expect(patches).toMatchObject([
      {
        text: 'I asked Grokbot, and Grokbot answered.',
        words: timed([
          ['I', 0, 100],
          ['asked', 150, 400],
          ['Grokbot,', 450, 1000],
          ['and', 1100, 1200],
          ['Grokbot', 1250, 1800],
          ['answered.', 1850, 2300],
        ]),
      },
    ])
  })

  test('splits one word into a multi-word replacement across its timing by character share', () => {
    const one = caption('c-2', 0, [
      ['thanks', 0, 400],
      ['Karenx', 500, 1400],
    ])
    const [patch] = correctCaptions([one], 'karenx', 'Karen X. Cheng').patches
    const words = patch?.words ?? []
    expect(words.map((w) => w.text)).toEqual(['thanks', 'Karen', 'X.', 'Cheng'])
    const [, karen, x, cheng] = words
    expect(karen?.startMs).toBe(500)
    expect(cheng?.endMs).toBe(1400)
    expect(karen?.endMs).toBe(x?.startMs)
    expect(x?.endMs).toBe(cheng?.startMs)
    expect(mapCaptionWords({ ...one, text: patch?.text ?? '', words })).not.toBeNull()
  })

  test('matches whole words only', () => {
    const text = caption('c-3', 0, [
      ['cutting', 0, 300],
      ['with', 350, 500],
      ['cut', 550, 700],
    ])
    const { patches, count } = correctCaptions([text], 'cut', 'mcut')
    expect(count).toBe(1)
    expect(patches).toMatchObject([{ text: 'cutting with mcut' }])
  })

  test('is idempotent once the text already reads the replacement', () => {
    const [fixed] = correctCaptions([MISHEARD], 'grok bot', 'Grokbot').patches
    const corrected = { ...MISHEARD, text: fixed?.text ?? '', words: fixed?.words ?? [] }
    expect(correctCaptions([corrected], 'grokbot', 'Grokbot')).toEqual({ patches: [], removedIds: [], count: 0 })
    const named = caption('c-n', 0, [
      ['Karen', 0, 300],
      ['X.', 300, 400],
      ['Cheng', 400, 700],
    ])
    expect(correctCaptions([named], 'Karen', 'Karen X. Cheng').count).toBe(0)
  })

  test('corrects captions without word timings as text', () => {
    const plain: TranscriptCaption = { id: 'c-p', startMs: 0, durationMs: 1000, text: 'hi Grok Bot' }
    expect(correctCaptions([plain], 'Grok Bot', 'Grokbot').patches).toMatchObject([{ captionId: 'c-p', text: 'hi Grokbot' }])
  })

  test('a name split across two captions moves into the first caption and the second starts after it', () => {
    const first = caption(
      'c-a',
      1000,
      [
        ['I', 0, 100],
        ['asked', 150, 400],
        ['Grok', 450, 700],
      ],
      700,
    )
    const second = caption(
      'c-b',
      1750,
      [
        ['Bot', 0, 250],
        ['something', 300, 800],
      ],
      800,
    )
    const { patches, removedIds, count } = correctCaptions([second, first], 'grok bot', 'Grokbot')
    expect(count).toBe(1)
    expect(removedIds).toEqual([])
    expect(patches).toMatchObject([
      { captionId: 'c-b', text: 'something', startMs: 2050, words: [{ text: 'something', startMs: 0, endMs: 500 }] },
      { captionId: 'c-a', text: 'I asked Grokbot', startMs: 1000, durationMs: 1050 },
    ])
    expect(patches.at(-1)?.words?.at(-1)).toEqual({ text: 'Grokbot', startMs: 450, endMs: 1000 })
  })

  test('a second caption made only of the rest of the name is removed', () => {
    const first = caption(
      'c-a',
      0,
      [
        ['hi', 0, 200],
        ['Grok', 300, 600],
      ],
      600,
    )
    const second = caption('c-b', 700, [['Bot.', 0, 300]], 300)
    const { patches, removedIds } = correctCaptions([first, second], 'Grok Bot', 'Grokbot')
    expect(removedIds).toEqual(['c-b'])
    expect(patches).toEqual([
      {
        captionId: 'c-a',
        text: 'hi Grokbot.',
        words: timed([
          ['hi', 0, 200],
          ['Grokbot.', 300, 1000],
        ]),
        startMs: 0,
        durationMs: 1000,
      },
    ])
  })
})

describe('correctWords', () => {
  test('corrects a source-time word list and keeps unrelated timings', () => {
    const result = correctWords(MISHEARD_WORDS, 'Grok Bot', 'Grokbot')
    expect(result.count).toBe(2)
    expect(result.words.map((w) => w.text).join(' ')).toBe('I asked Grokbot, and Grokbot answered.')
    expect(result.words.at(-1)).toEqual({ text: 'answered.', startMs: 1850, endMs: 2300 })
  })
})

describe('retypeCaption', () => {
  test('keeps the timing of untouched words and gives the edited span the timing of the words it replaces', () => {
    const patch = retypeCaption(MISHEARD, 'I asked Grokbot, and grok bot answered.')
    expect(patch.text).toBe('I asked Grokbot, and grok bot answered.')
    expect(patch.words).toEqual([...MISHEARD_WORDS.slice(0, 2), { text: 'Grokbot,', startMs: 450, endMs: 1000 }, ...MISHEARD_WORDS.slice(4)])
  })

  test('an inserted word shares the timing of its neighbour', () => {
    const patch = retypeCaption(MISHEARD, 'I really asked Grok Bot, and grok bot answered.')
    expect(patch.words?.slice(0, 2)).toEqual([
      { text: 'I', startMs: 0, endMs: 14 },
      { text: 'really', startMs: 14, endMs: 100 },
    ])
    expect(patch.words?.slice(2)).toEqual(MISHEARD_WORDS.slice(1))
  })

  test('keeps the typed text as is, trailing space included', () => {
    const patch = retypeCaption(MISHEARD, `${MISHEARD.text} `)
    expect(patch.text).toBe(`${MISHEARD.text} `)
    expect(patch.words).toEqual(MISHEARD_WORDS)
  })
})
