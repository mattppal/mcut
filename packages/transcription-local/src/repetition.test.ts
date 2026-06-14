import { describe, expect, test } from 'bun:test'
import { hasRepetitionLoop, textHasRepetitionLoop } from './repetition'

describe('hasRepetitionLoop', () => {
  test('normal speech is clean', () => {
    expect(
      textHasRepetitionLoop('the quick brown fox jumps over the lazy dog and keeps going'),
    ).toBe(false)
  })

  test('detects single-token loops', () => {
    expect(textHasRepetitionLoop('so so so so so so so')).toBe(true)
  })

  test('tolerates natural double words', () => {
    expect(textHasRepetitionLoop('it was very very good honestly')).toBe(false)
  })

  test('detects phrase loops (the whisper silence failure)', () => {
    expect(textHasRepetitionLoop('thanks for watching thanks for watching thanks for watching')).toBe(
      true,
    )
  })

  test('punctuation and case do not hide the loop', () => {
    expect(textHasRepetitionLoop('Okay. Okay! okay, OKAY. okay? Okay.')).toBe(true)
  })

  test('respects explicit thresholds', () => {
    expect(hasRepetitionLoop(['a', 'b', 'a', 'b'], { minRepeats: 2 })).toBe(true)
  })
})
