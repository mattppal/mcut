import { describe, expect, test } from 'bun:test'
import type { AudioBufferSink } from 'mediabunny'
import { decodeCompositeRange } from './export-audio-composite'
import { buildSourceTiming, timedSink, type PacketIndex, type TimingFacts } from './source-timing'
import { valueAt } from './value-at'

interface FakePacket {
  timestamp: number
  data: Uint8Array
  frames: number
  content: number
}

interface FakeSource {
  facts: TimingFacts
  packets: FakePacket[]
  discardFrames: number
  silentFirstPacket: boolean
}

const MID_S = 0.5
const SPAN_S = 0.0625
const CELT_20_MS = new Uint8Array([0xfc])

function facts(known: Pick<TimingFacts, 'container' | 'codec'> & Partial<TimingFacts>): TimingFacts {
  return { sampleRate: 48_000, resolution: 48_000, leadFrames: 0, preSkip: 0, vorbisShortBlock: 0, ...known }
}

function source(timing: TimingFacts, packets: FakePacket[], decoder: Partial<Pick<FakeSource, 'discardFrames' | 'silentFirstPacket'>> = {}): FakeSource {
  return { facts: timing, packets, discardFrames: 0, silentFirstPacket: false, ...decoder }
}

function framedPackets(frames: number, label: (index: number) => number, content: (index: number) => number, data = new Uint8Array(0)): FakePacket[] {
  return Array.from({ length: 64 }, (_, index) => ({ timestamp: label(index), data, frames, content: content(index) }))
}

function vorbisPackets(label: (contentFrame: number) => number): FakePacket[] {
  const content = [0, 0, 128, ...Array.from({ length: 61 }, (_, index) => 704 + index * 1024)]
  const frames = [0, 128, 576, ...Array.from({ length: 61 }, () => 1024)]
  return content.map((start, index) => ({ timestamp: index === 0 ? 0 : label(start), data: new Uint8Array(0), frames: valueAt(frames, index), content: start }))
}

function keyPacket(packets: FakePacket[], timestamp: number): FakePacket | null {
  const latest = packets.findLast((packet) => packet.timestamp <= timestamp)
  return latest ? (packets.find((packet) => packet.timestamp === latest.timestamp) ?? null) : null
}

function packetIndex(packets: FakePacket[]): PacketIndex<FakePacket> {
  return {
    getFirstPacket: async () => packets[0] ?? null,
    getKeyPacket: async (timestamp) => keyPacket(packets, timestamp),
    getNextPacket: async (packet) => packets[packets.indexOf(packet) + 1] ?? null,
  }
}

function monoBuffer(samples: Float32Array<ArrayBuffer>, sampleRate: number): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
    copyFromChannel: (destination) => destination.set(samples.subarray(0, destination.length)),
    copyToChannel: (data) => samples.set(data),
  }
}

function decoderSink({ facts: { sampleRate }, packets, discardFrames, silentFirstPacket }: FakeSource): Pick<AudioBufferSink, 'buffers'> {
  return {
    async *buffers(start = 0, end = Infinity) {
      const first = packets.indexOf(keyPacket(packets, start) ?? valueAt(packets, 0))
      let label = Math.round(valueAt(packets, first).timestamp * sampleRate)
      let discard = discardFrames
      let outputs = 0
      for (const packet of packets.slice(first + (silentFirstPacket ? 1 : 0))) {
        const dropped = Math.min(discard, packet.frames)
        discard -= dropped
        const frames = packet.frames - dropped
        if (frames === 0) continue
        if (label / sampleRate >= end) return
        const garble = first > 0 && outputs === 0 ? 0.5 : 0
        outputs++
        const samples = Float32Array.from({ length: frames }, (_, frame) => packet.content + dropped + frame + garble)
        if ((label + frames) / sampleRate > start)
          yield { buffer: monoBuffer(samples, sampleRate), timestamp: label / sampleRate, duration: frames / sampleRate }
        label += frames
      }
    },
  }
}

function runs(samples: Float32Array): [number, number][] {
  const found: [number, number][] = []
  for (const [index, value] of samples.entries()) {
    const run = found.at(-1)
    if (run && index > 0 && value === valueAt(samples, index - 1) + 1) run[1]++
    else found.push([value, 1])
  }
  return found
}

async function decodedRuns(fake: FakeSource, startS: number): Promise<[number, number][] | string> {
  const timing = await buildSourceTiming(fake.facts, packetIndex(fake.packets), valueAt(fake.packets, 0))
  const decoded = await decodeCompositeRange(timedSink(decoderSink(fake), timing), startS, SPAN_S, 'all')
  return decoded.status === 'ready' ? runs(valueAt(decoded.audio.channels, 0)) : decoded.status
}

const SOURCES: [string, FakeSource][] = [
  [
    'mp3 with a LAME tag',
    source(
      facts({ container: 'mp3', codec: 'mp3', leadFrames: 1105 }),
      framedPackets(
        1152,
        (index) => (index * 1152) / 48_000,
        (index) => index * 1152 - 1105,
      ),
    ),
  ],
  [
    'aac in m4a with iTunSMPB and no edit list',
    source(
      facts({ container: 'isobmff', codec: 'aac', sampleRate: 44_100, resolution: 44_100, leadFrames: 2048 }),
      framedPackets(
        1024,
        (index) => (index * 1024) / 44_100,
        (index) => index * 1024 - 2048,
      ),
    ),
  ],
  [
    'aac in mkv with a codec delay',
    source(
      facts({ container: 'matroska', codec: 'aac', resolution: 1000, leadFrames: 1024 }),
      framedPackets(
        1024,
        (index) => (Math.round(((index - 1) * 1024) / 48) + 21) / 1000,
        (index) => index * 1024 - 1024,
      ),
    ),
  ],
  [
    'aac in adts',
    source(
      facts({ container: 'other', codec: 'aac' }),
      framedPackets(
        1024,
        (index) => (index * 1024) / 48_000,
        (index) => index * 1024,
      ),
    ),
  ],
  [
    'opus in ogg',
    source(
      facts({ container: 'ogg', codec: 'opus', preSkip: 312 }),
      framedPackets(
        960,
        (index) => Math.max(0, index * 960 - 312) / 48_000,
        (index) => index * 960 - 312,
        CELT_20_MS,
      ),
      { discardFrames: 312 },
    ),
  ],
  [
    'opus in mp4 with an edit list',
    source(
      facts({ container: 'isobmff', codec: 'opus', preSkip: 312 }),
      framedPackets(
        960,
        (index) => (index * 960 - 312) / 48_000,
        (index) => index * 960 - 312,
        CELT_20_MS,
      ),
      { discardFrames: 312 },
    ),
  ],
  [
    'opus in webm with millisecond timestamps',
    source(
      facts({ container: 'matroska', codec: 'opus', resolution: 1000, preSkip: 312 }),
      framedPackets(
        960,
        (index) => (index === 0 ? 0 : (20 * index + 1) / 1000),
        (index) => index * 960 - 312,
        CELT_20_MS,
      ),
      { discardFrames: 312 },
    ),
  ],
  [
    'vorbis in ogg',
    source(
      facts({ container: 'ogg', codec: 'vorbis', vorbisShortBlock: 256 }),
      vorbisPackets((contentFrame) => contentFrame / 48_000),
      { silentFirstPacket: true },
    ),
  ],
  [
    'vorbis in webm with millisecond timestamps',
    source(
      facts({ container: 'matroska', codec: 'vorbis', resolution: 1000, vorbisShortBlock: 256 }),
      vorbisPackets((contentFrame) => Math.ceil((contentFrame + 128) / 48) / 1000),
      { silentFirstPacket: true },
    ),
  ],
]

describe('timedSink', () => {
  test.each(SOURCES)('%s decodes the file start at source time zero', async (_, fake) => {
    expect(await decodedRuns(fake, 0)).toEqual([[0, Math.ceil(SPAN_S * fake.facts.sampleRate)]])
  })

  test.each(SOURCES)('%s decodes a mid-file range at its source time', async (_, fake) => {
    expect(await decodedRuns(fake, MID_S)).toEqual([[MID_S * fake.facts.sampleRate, Math.ceil(SPAN_S * fake.facts.sampleRate)]])
  })

  test('keeps MediaRecorder timestamps that drift past the container tick', async () => {
    const recorded = source(
      facts({ container: 'matroska', codec: 'opus', resolution: 1000, preSkip: 312 }),
      framedPackets(
        960,
        (index) => (index === 0 ? 0 : (20 * index + 5) / 1000),
        (index) => index * 960 - 312,
        CELT_20_MS,
      ),
      { discardFrames: 312 },
    )
    expect(await decodedRuns(recorded, MID_S)).toEqual([[23_760, 3000]])
  })
})
