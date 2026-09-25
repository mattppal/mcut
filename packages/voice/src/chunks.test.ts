import { describe, expect, test } from 'bun:test'
import { planChunks } from './chunks'

describe('planChunks', () => {
  test('splits on frame boundaries with a one second pre-roll and a 50 ms post-roll', () => {
    expect(planChunks(144_000, 3)).toEqual([
      { from: 0, to: 50_400, start: 0, end: 48_000 },
      { from: 0, to: 98_400, start: 48_000, end: 96_000 },
      { from: 48_000, to: 144_000, start: 96_000, end: 144_000 },
    ])
  })

  test('gives the last chunk the samples that frame alignment leaves over', () => {
    expect(planChunks(100_000, 2)).toEqual([
      { from: 0, to: 52_320, start: 0, end: 49_920 },
      { from: 1_920, to: 100_000, start: 49_920, end: 100_000 },
    ])
  })

  test('plans at most one chunk per second of audio', () => {
    expect(planChunks(144_000, 8).map((chunk) => chunk.start)).toEqual([0, 48_000, 96_000])
    expect(planChunks(30_000, 4)).toEqual([{ from: 0, to: 30_000, start: 0, end: 30_000 }])
  })
})
