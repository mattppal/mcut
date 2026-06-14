import { describe, expect, test } from 'bun:test'
import { planarAudioChunks } from './export-core'
import type { MixedAudioData } from './export-types'

function ramp(length: number, offset = 0): Float32Array {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = offset + i
  return data
}

describe('planarAudioChunks', () => {
  test('splits planar stereo into [left|right] chunks with correct timestamps', () => {
    const mixed: MixedAudioData = { left: ramp(10), right: ramp(10, 100), sampleRate: 5 }
    const chunks = [...planarAudioChunks(mixed, 4)]

    expect(chunks.map((c) => c.frames)).toEqual([4, 4, 2])
    expect(chunks.map((c) => c.timestamp)).toEqual([0, 0.8, 1.6])
    // f32-planar layout: each channel contiguous within the chunk.
    expect([...chunks[1]!.data]).toEqual([4, 5, 6, 7, 104, 105, 106, 107])
    expect([...chunks[2]!.data]).toEqual([8, 9, 108, 109])
  })

  test('covers every frame exactly once', () => {
    const mixed: MixedAudioData = { left: ramp(48_123), right: ramp(48_123), sampleRate: 48_000 }
    let frames = 0
    for (const chunk of planarAudioChunks(mixed)) {
      expect(chunk.data.length).toBe(chunk.frames * 2)
      frames += chunk.frames
    }
    expect(frames).toBe(48_123)
  })

  test('mismatched channel lengths clamp to the shorter channel', () => {
    const mixed: MixedAudioData = { left: ramp(6), right: ramp(4), sampleRate: 10 }
    const frames = [...planarAudioChunks(mixed, 8)].reduce((sum, c) => sum + c.frames, 0)
    expect(frames).toBe(4)
  })

  test('empty mix yields no chunks', () => {
    const mixed: MixedAudioData = { left: new Float32Array(0), right: new Float32Array(0), sampleRate: 48_000 }
    expect([...planarAudioChunks(mixed)]).toEqual([])
  })
})
