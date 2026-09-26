import { describe, expect, test } from 'bun:test'
import type { AudioBufferSink } from 'mediabunny'
import { decodeCompositeRange, decoderLeadStart, lateStart, reversedChunkSpans } from './export-audio-composite'

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

const RATE = 48_000
const PACKET = 1_024
const source = Float32Array.from({ length: 64 * PACKET }, (_, frame) => Math.sin(frame / 7))

function packetBuffer(samples: Float32Array<ArrayBuffer>): AudioBuffer {
  return {
    sampleRate: RATE,
    length: samples.length,
    duration: samples.length / RATE,
    numberOfChannels: 1,
    getChannelData: () => samples,
    copyFromChannel: (destination) => destination.set(samples.subarray(0, destination.length)),
    copyToChannel: (data) => samples.set(data),
  }
}

function freshDecoderSink(): Pick<AudioBufferSink, 'buffers'> {
  return {
    async *buffers(start = 0, end = Infinity) {
      const first = Math.floor((start * RATE) / PACKET)
      for (let packet = first; packet * PACKET < Math.min(end * RATE, source.length); packet++) {
        const samples = source.slice(packet * PACKET, (packet + 1) * PACKET)
        if (packet === first && packet > 0) samples.fill(0)
        yield { buffer: packetBuffer(samples), timestamp: (packet * PACKET) / RATE, duration: PACKET / RATE }
      }
    },
  }
}

describe('decodeCompositeRange', () => {
  test('returns the source for a mid-file range although a fresh decoder botches its first packet', async () => {
    expect(await decodeCompositeRange(freshDecoderSink(), 0.5, 0.0625, 'all')).toEqual({
      status: 'ready',
      audio: { channels: [source.slice(24_000, 27_000)], sampleRate: RATE },
    })
  })

  test('returns the source for a range that starts inside the second packet', async () => {
    expect(await decodeCompositeRange(freshDecoderSink(), 0.03125, 0.0625, 'all')).toEqual({
      status: 'ready',
      audio: { channels: [source.slice(1_500, 4_500)], sampleRate: RATE },
    })
  })
})

describe('lateStart', () => {
  test('a node placed at or after the context clock starts where it was placed', () => {
    expect(lateStart({ whenS: 10, offsetS: 0.5, durationS: 2 }, 1, 0)).toEqual({ whenS: 10, offsetS: 0.5, durationS: 2 })
  })

  test('a node placed before the context clock starts now, skipping what was already due', () => {
    expect(lateStart({ whenS: 10, offsetS: 0.5, durationS: 2 }, 2, 10.25)).toEqual({ whenS: 10.25, offsetS: 1, durationS: 1.5 })
  })

  test('a node that should already have finished plays nothing', () => {
    expect(lateStart({ whenS: 10, offsetS: 0, durationS: 1 }, 1, 12)).toBeNull()
  })
})
