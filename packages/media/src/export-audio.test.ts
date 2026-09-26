import { describe, expect, test } from 'bun:test'
import { decoderLeadStart, reversedChunkSpans } from './export-audio-composite'

describe('reversedChunkSpans', () => {
  test('plays the source from the end in bounded pieces', () => {
    expect(reversedChunkSpans(100, 30)).toEqual([
      { sourceFrame: 70, frames: 30, outputFrame: 0 },
      { sourceFrame: 40, frames: 30, outputFrame: 30 },
      { sourceFrame: 10, frames: 30, outputFrame: 60 },
      { sourceFrame: 0, frames: 10, outputFrame: 90 },
    ])
  })

  test('covers every source frame once', () => {
    const totalFrames = 10_007
    const spans = reversedChunkSpans(totalFrames, 3_000)
    const covered = new Uint8Array(totalFrames)
    let outputFrame = 0
    for (const span of spans) {
      expect(span.outputFrame).toBe(outputFrame)
      expect(span.sourceFrame + span.frames + span.outputFrame).toBe(totalFrames)
      for (let frame = span.sourceFrame; frame < span.sourceFrame + span.frames; frame++) {
        expect(covered[frame]).toBe(0)
        covered[frame] = 1
      }
      outputFrame += span.frames
    }
    expect(outputFrame).toBe(totalFrames)
    expect(covered.every((bit) => bit === 1)).toBe(true)
  })

  test('rejects a non-positive chunk or total', () => {
    expect(reversedChunkSpans(10, 0)).toEqual([])
    expect(reversedChunkSpans(0, 10)).toEqual([])
  })
})

describe('decoderLeadStart', () => {
  test('starts two AAC packets before a mid-file decode and stays put at the file start', () => {
    expect(decoderLeadStart(10, 2048, 48_000)).toBe(10 - 2048 / 48_000)
    expect(decoderLeadStart(0, 2048, 48_000)).toBe(0)
    expect(decoderLeadStart(0.01, 2048, 48_000)).toBe(0)
  })
})
