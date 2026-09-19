import { describe, expect, test } from 'bun:test'
import { hasRepetitionLoop, textHasRepetitionLoop } from './repetition'

describe('hasRepetitionLoop', () => {
  test('normal speech is clean', () => {
    expect(textHasRepetitionLoop('the quick brown fox jumps over the lazy dog and keeps going')).toBe(false)
  })

  test('detects single-token loops', () => {
    expect(textHasRepetitionLoop('so so so so so so so')).toBe(true)
  })

  test('tolerates natural double words', () => {
    expect(textHasRepetitionLoop('it was very very good honestly')).toBe(false)
  })

  test('detects phrase loops (the whisper silence failure)', () => {
    expect(textHasRepetitionLoop('thanks for watching thanks for watching thanks for watching')).toBe(true)
  })

  test('punctuation and case do not hide the loop', () => {
    expect(textHasRepetitionLoop('Okay. Okay! okay, OKAY. okay? Okay.')).toBe(true)
  })

  test('respects explicit thresholds', () => {
    expect(hasRepetitionLoop(['a', 'b', 'a', 'b'], { minRepeats: 2 })).toBe(true)
  })

  test('unigrams need 6 repeats, bigrams need 4, longer ngrams need 3', () => {
    expect(hasRepetitionLoop(['a', 'a', 'a', 'a', 'a'])).toBe(false)
    expect(hasRepetitionLoop(['a', 'a', 'a', 'a', 'a', 'a'])).toBe(true)
    expect(hasRepetitionLoop(['a', 'b', 'a', 'b', 'a', 'b'])).toBe(false)
    expect(hasRepetitionLoop(['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b'])).toBe(true)
    expect(hasRepetitionLoop(['a', 'b', 'c', 'a', 'b', 'c'])).toBe(false)
    expect(hasRepetitionLoop(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'])).toBe(true)
  })
})
