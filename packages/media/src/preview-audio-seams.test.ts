import { describe, expect, test } from 'bun:test'
import type { AudioBufferSink, WrappedAudioBuffer } from 'mediabunny'
import { decodeCompositeRange, type AudibleSegment } from './export-audio-composite'
import { stretchStereo } from './time-stretch'
import { VoiceFeed } from './preview-audio-feed'
import { planFeed, sourceMapOf, type AudioAnchor } from './preview-audio-plan'

const SAMPLE_RATE = 48_000
const PACKET_FRAMES = 960

interface FakePacket {
  nominalS: number
  stampS: number
  data: Float32Array<ArrayBuffer>
}

function packetsOf(signal: Float32Array<ArrayBuffer>, jitterS: (index: number) => number): FakePacket[] {
  const packets: FakePacket[] = []
  for (let index = 0; index * PACKET_FRAMES < signal.length; index++) {
    const nominalS = (index * PACKET_FRAMES) / SAMPLE_RATE
    packets.push({ nominalS, stampS: nominalS + jitterS(index), data: signal.slice(index * PACKET_FRAMES, (index + 1) * PACKET_FRAMES) })
  }
  return packets
}

function wrapped(data: Float32Array<ArrayBuffer>, timestamp: number): WrappedAudioBuffer {
  const buffer: AudioBuffer = {
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 2,
    length: data.length,
    duration: data.length / SAMPLE_RATE,
    getChannelData: () => data,
    copyFromChannel: (destination) => destination.set(data.subarray(0, destination.length)),
    copyToChannel: (source) => data.set(source),
  }
  return { buffer, timestamp, duration: buffer.duration }
}

function accumulatingSink(packets: FakePacket[]): Pick<AudioBufferSink, 'buffers'> {
  return {
    async *buffers(startS = 0, endS = Infinity) {
      let clockS: number | null = null
      for (const packet of packets) {
        const durationS = packet.data.length / SAMPLE_RATE
        if (packet.nominalS + durationS <= startS) continue
        if (packet.nominalS >= endS) return
        if (clockS === null || Math.abs(packet.stampS - clockS) >= durationS) clockS = packet.stampS
        const stampS = Math.round(clockS * SAMPLE_RATE) / SAMPLE_RATE
        clockS += durationS
        yield wrapped(packet.data, stampS)
      }
    },
  }
}

async function previewOf(sink: Pick<AudioBufferSink, 'buffers'>, segment: AudibleSegment, anchor: AudioAnchor): Promise<Float32Array> {
  const map = sourceMapOf(segment)
  if (map.kind !== 'linear') throw new Error('a speed curve plays through windows, not a feed')
  const planned = planFeed(segment, map, anchor, anchor.contextS)
  if (!planned) throw new Error('the clip is already over')
  const feed = await VoiceFeed.open(sink, planned.plan, new AbortController().signal)
  if (!feed) throw new Error('the source decoded nothing')
  const out = new Float32Array(Math.round((planned.endS - planned.startS) * SAMPLE_RATE))
  for (let untilS = 0.5; ; untilS += 0.5) {
    const chunk = await feed.take(Math.min(untilS, planned.endS - planned.startS), new AbortController().signal)
    out.set(chunk.channels[0] ?? new Float32Array(0), Math.round(chunk.offsetS * SAMPLE_RATE))
    if (untilS >= planned.endS - planned.startS) break
  }
  feed.close()
  return out
}

function tone(seconds: number, hz: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  for (let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)
  return data
}

function noise(seconds: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  let seed = 7
  let low = 0
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    low += 0.2 * (seed / 1_073_741_824 - 1 - low)
    data[i] = low
  }
  return data
}

function envelopeFloor(signal: Float32Array, fromS: number, toS: number): number {
  const block = Math.round(0.01 * SAMPLE_RATE)
  const levels: number[] = []
  for (let start = Math.round(fromS * SAMPLE_RATE); start + block <= Math.round(toS * SAMPLE_RATE); start += block) {
    let energy = 0
    for (let i = start; i < start + block; i++) energy += (signal[i] ?? 0) ** 2
    levels.push(Math.sqrt(energy / block))
  }
  const sorted = [...levels].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return (sorted[0] ?? 0) / median
}

describe('preview audio window seams', () => {
  const clip: AudibleSegment = { elementId: 'e-1', src: 'blob:a', startMs: 0, durationMs: 4000, trimStartMs: 0, sourceSpanMs: 4000, volume: 1 }

  for (const rate of [1.5, 2, 4]) {
    test(`a 440 Hz tone played at ${rate}x keeps a steady envelope across window seams`, async () => {
      const sink = accumulatingSink(packetsOf(tone(10, 440), () => 0))
      const segment = { ...clip, durationMs: 2000 * rate, sourceSpanMs: 2000 * rate }
      const heard = await previewOf(sink, segment, { timelineMs: 300 * rate, contextS: 0, rate })
      expect(envelopeFloor(heard, 0.1, heard.length / SAMPLE_RATE - 0.1)).toBeGreaterThan(0.95)
    }, 20_000)
  }

  test('a reversed 440 Hz tone played at 2x keeps a steady envelope across window seams', async () => {
    const sink = accumulatingSink(packetsOf(tone(10, 440), () => 0))
    const heard = await previewOf(sink, { ...clip, reversed: true }, { timelineMs: 600, contextS: 0, rate: 2 })
    expect(envelopeFloor(heard, 0.1, heard.length / SAMPLE_RATE - 0.1)).toBeGreaterThan(0.95)
  }, 20_000)

  for (const speed of [0.5, 1.5, 2]) {
    test(`a clip at speed ${speed} played from its start is the samples export stretches`, async () => {
      const sink = accumulatingSink(packetsOf(noise(8), () => 0))
      const spanMs = 3000 * speed
      const segment: AudibleSegment = {
        ...clip,
        durationMs: 3000,
        sourceSpanMs: spanMs,
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 3000, value: spanMs },
        ],
      }
      const exported = await decodeCompositeRange(sink, 0, spanMs / 1000, 'stereo')
      if (exported.status !== 'ready') throw new Error(`export decoded ${exported.status}`)
      const [left = new Float32Array(0), right = left] = exported.audio.channels
      const truth = await stretchStereo({ left, right, sampleRate: SAMPLE_RATE }, speed)
      expect(await previewOf(sink, segment, { timelineMs: 0, contextS: 0, rate: 1 })).toEqual(truth.left)
    }, 20_000)
  }

  test('a source with jittered packet timestamps plays the samples a single export decode places', async () => {
    const signal = noise(4)
    const sink = accumulatingSink(packetsOf(signal, (index) => (index === 0 ? 0 : 0.008 * Math.sin(index * 2.3))))
    const exported = await decodeCompositeRange(sink, 0, clip.durationMs / 1000, 'stereo')
    if (exported.status !== 'ready') throw new Error(`export decoded ${exported.status}`)
    const truth = exported.audio.channels[0] ?? new Float32Array(0)
    const heard = await previewOf(sink, clip, { timelineMs: 0, contextS: 0, rate: 1 })
    let worst = 0
    for (let i = 0; i < heard.length - SAMPLE_RATE * 0.05; i++) worst = Math.max(worst, Math.abs((heard[i] ?? 0) - (truth[i] ?? 0)))
    expect(worst).toBeLessThan(1e-4)
  })
})
