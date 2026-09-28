import { describe, expect, test } from 'bun:test'
import { hasSpeechAfter } from './vad'

const RATE = 16_000

function audio(speechRangesS: Array<[number, number]>, durationS: number): Float32Array {
  const samples = new Float32Array(durationS * RATE)
  for (const [fromS, toS] of speechRangesS) {
    for (let i = fromS * RATE; i < toS * RATE; i++) samples[i] = 0.1 * Math.sin(i / 7)
  }
  return samples
}

describe('hasSpeechAfter', () => {
  test('finds speech a decode left out after its last word', () => {
    expect(
      hasSpeechAfter(
        audio(
          [
            [0, 4],
            [6, 9],
          ],
          10,
        ),
        RATE,
        4,
      ),
    ).toBe(true)
  })

  test('silence or a sliver of audio after the last word is not speech left out', () => {
    expect(hasSpeechAfter(audio([[0, 4]], 10), RATE, 4)).toBe(false)
    expect(hasSpeechAfter(audio([[0, 10]], 10), RATE, 9.5)).toBe(false)
  })
})
