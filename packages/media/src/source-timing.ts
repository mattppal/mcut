import type { AudioBufferSink, AudioCodec, EncodedPacket, Input, InputAudioTrack } from 'mediabunny'
import {
  itunesPrimingFrames,
  lameStartSkipFrames,
  matroskaCodecDelayNs,
  opusPacketFrames,
  opusPreSkip,
  vorbisShortBlockFrames,
  type ByteReader,
} from './gapless-tags'
import type { MediaSourceLike } from './probe'

type Container = 'mp3' | 'isobmff' | 'matroska' | 'ogg' | 'other'

type StartRule = 'lead' | 'ogg-opus' | 'isobmff-opus' | 'matroska-opus' | 'matroska-frames' | 'vorbis'

const START_RULES: readonly { container: Container; codec: AudioCodec; rule: StartRule }[] = [
  { container: 'ogg', codec: 'opus', rule: 'ogg-opus' },
  { container: 'isobmff', codec: 'opus', rule: 'isobmff-opus' },
  { container: 'matroska', codec: 'opus', rule: 'matroska-opus' },
  { container: 'matroska', codec: 'aac', rule: 'matroska-frames' },
  { container: 'matroska', codec: 'mp3', rule: 'matroska-frames' },
  { container: 'ogg', codec: 'vorbis', rule: 'vorbis' },
  { container: 'matroska', codec: 'vorbis', rule: 'vorbis' },
]

const MATROSKA_FRAME_SIZES: Partial<Record<AudioCodec, number>> = { aac: 1024, mp3: 1152 }
const MAX_SESSION_STEPS = 8

export interface TimedPacket {
  timestamp: number
  data: Uint8Array
}

export interface PacketIndex<P extends TimedPacket> {
  getFirstPacket(): Promise<P | null>
  getKeyPacket(timestamp: number, options: { verifyKeyPackets: boolean }): Promise<P | null>
  getNextPacket(packet: P): Promise<P | null>
}

export interface SourceTiming<P extends TimedPacket> {
  rule: StartRule
  sampleRate: number
  tickS: number
  leadFrames: number
  preSkip: number
  gridFrames: number
  first: P
  second: P | null
  packets: PacketIndex<P>
}

export interface TimingFacts {
  container: Container
  codec: AudioCodec | null
  sampleRate: number
  resolution: number
  leadFrames: number
  preSkip: number
  vorbisShortBlock: number
}

export async function buildSourceTiming<P extends TimedPacket>(facts: TimingFacts, packets: PacketIndex<P>, first: P): Promise<SourceTiming<P>> {
  const rule = START_RULES.find((row) => row.container === facts.container && row.codec === facts.codec)?.rule ?? 'lead'
  const gridFrames = rule === 'vorbis' ? facts.vorbisShortBlock / 4 : facts.codec ? (MATROSKA_FRAME_SIZES[facts.codec] ?? 0) : 0
  return {
    rule,
    sampleRate: facts.sampleRate,
    tickS: 1 / facts.resolution,
    leadFrames: facts.leadFrames,
    preSkip: facts.preSkip,
    gridFrames,
    first,
    second: rule === 'vorbis' ? await packets.getNextPacket(first) : null,
    packets,
  }
}

function snapToFrames(offsetS: number, frames: number, { sampleRate, tickS }: { sampleRate: number; tickS: number }): number {
  if (frames <= 0) return offsetS
  const offsetFrames = Math.round(offsetS * sampleRate)
  const snapped = Math.round(offsetFrames / frames) * frames
  return Math.abs(snapped - offsetFrames) <= tickS * sampleRate + 0.5 ? snapped / sampleRate : offsetS
}

function sampleGridS(timestampS: number, sampleRate: number): number {
  return Math.round(timestampS * sampleRate) / sampleRate
}

async function sessionStartS<P extends TimedPacket>(start: P, timing: SourceTiming<P>): Promise<number> {
  const { first, sampleRate } = timing
  switch (timing.rule) {
    case 'lead':
      return start.timestamp - timing.leadFrames / sampleRate
    case 'ogg-opus':
      return start.timestamp > first.timestamp ? start.timestamp + timing.preSkip / sampleRate : start.timestamp
    case 'isobmff-opus':
      return start.timestamp + (first.timestamp < 0 ? timing.preSkip / sampleRate : 0)
    case 'matroska-opus':
      return first.timestamp + snapToFrames(start.timestamp - first.timestamp, opusPacketFrames(start.data), timing)
    case 'matroska-frames':
      return first.timestamp + snapToFrames(start.timestamp - first.timestamp, timing.gridFrames, timing) - timing.leadFrames / sampleRate
    case 'vorbis': {
      const next = await timing.packets.getNextPacket(start)
      if (!next || !timing.second) return start.timestamp
      return first.timestamp + snapToFrames(next.timestamp - timing.second.timestamp, timing.gridFrames, timing)
    }
    default: {
      const unhandled: never = timing.rule
      throw new Error(`Unknown source timing rule ${JSON.stringify(unhandled)}.`)
    }
  }
}

async function sessionAt<P extends TimedPacket>(startS: number, timing: SourceTiming<P>): Promise<{ packet: P; startS: number }> {
  const firstStartS = await sessionStartS(timing.first, timing)
  if (startS <= Math.max(0, firstStartS)) return { packet: timing.first, startS: firstStartS }
  let label = startS + timing.leadFrames / timing.sampleRate
  for (let step = 0; step < MAX_SESSION_STEPS; step++) {
    const found = await timing.packets.getKeyPacket(label, { verifyKeyPackets: true })
    if (!found || found.timestamp <= timing.first.timestamp) break
    const foundStartS = await sessionStartS(found, timing)
    if (foundStartS <= startS + 0.5 / timing.sampleRate) return { packet: found, startS: foundStartS }
    label = found.timestamp - timing.tickS
  }
  return { packet: timing.first, startS: firstStartS }
}

export function timedSink<P extends TimedPacket>(sink: Pick<AudioBufferSink, 'buffers'>, timing: SourceTiming<P>): Pick<AudioBufferSink, 'buffers'> {
  if (timing.rule === 'lead' && timing.leadFrames === 0) return sink
  const { sampleRate } = timing
  return {
    async *buffers(startS = 0, endS = Infinity) {
      const session = await sessionAt(startS, timing)
      const shiftS = session.startS - sampleGridS(session.packet.timestamp, sampleRate)
      for await (const { buffer, timestamp, duration } of sink.buffers(session.packet.timestamp, endS - shiftS)) {
        yield { buffer, timestamp: sampleGridS(timestamp + shiftS, sampleRate), duration }
      }
    },
  }
}

async function zeroLabelS<P extends TimedPacket>(session: P, timing: SourceTiming<P>): Promise<number> {
  return sampleGridS(session.timestamp, timing.sampleRate) - (await sessionStartS(session, timing))
}

export async function sourceStartLabelS<P extends TimedPacket>(timing: SourceTiming<P>): Promise<number> {
  const guessS = await zeroLabelS(timing.first, timing)
  const session = await timing.packets.getKeyPacket(guessS, { verifyKeyPackets: true })
  return session ? zeroLabelS(session, timing) : guessS
}

function byteReader(src: MediaSourceLike): ByteReader {
  if (typeof src !== 'string') return async (start, end) => new Uint8Array(await src.slice(start, end).arrayBuffer())
  return async (start, end) => {
    const response = await fetch(src, { headers: { Range: `bytes=${start}-${end - 1}` } })
    if (response.status === 206) return new Uint8Array(await response.arrayBuffer())
    if (!response.ok) throw new Error(`Reading bytes ${start}-${end - 1} of ${src} failed with HTTP ${response.status}.`)
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    while (reader && received < end) {
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(chunk.value)
      received += chunk.value.length
    }
    await reader?.cancel()
    const whole = new Uint8Array(received)
    let at = 0
    for (const chunk of chunks) {
      whole.set(chunk, at)
      at += chunk.length
    }
    return whole.subarray(start, end)
  }
}

function descriptionBytes(description: AllowSharedBufferSource | undefined): Uint8Array {
  if (!description) return new Uint8Array(0)
  return ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description)
}

async function containerOf(input: Input): Promise<Container> {
  const { IsobmffInputFormat, MatroskaInputFormat, Mp3InputFormat, OggInputFormat } = await import('mediabunny')
  const format = await input.getFormat()
  if (format instanceof Mp3InputFormat) return 'mp3'
  if (format instanceof IsobmffInputFormat) return 'isobmff'
  if (format instanceof MatroskaInputFormat) return 'matroska'
  return format instanceof OggInputFormat ? 'ogg' : 'other'
}

async function leadFramesOf(container: Container, src: MediaSourceLike, track: InputAudioTrack, firstTimestamp: number): Promise<number> {
  const read = byteReader(src)
  switch (container) {
    case 'mp3':
      return lameStartSkipFrames(read)
    case 'isobmff':
      return track.codec === 'aac' && firstTimestamp === 0 ? itunesPrimingFrames(read) : 0
    case 'matroska':
      return track.codec === 'opus' ? 0 : Math.round(((await matroskaCodecDelayNs(read, track.id)) * track.sampleRate) / 1e9)
    case 'ogg':
    case 'other':
      return 0
    default: {
      const unhandled: never = container
      throw new Error(`Unknown container ${JSON.stringify(unhandled)}.`)
    }
  }
}

async function readTimingFacts(src: MediaSourceLike, input: Input, track: InputAudioTrack, firstTimestamp: number): Promise<TimingFacts> {
  const container = await containerOf(input)
  const header = descriptionBytes((await track.getDecoderConfig())?.description)
  return {
    container,
    codec: track.codec,
    sampleRate: track.sampleRate,
    resolution: await track.getTimeResolution(),
    leadFrames: await leadFramesOf(container, src, track, firstTimestamp),
    preSkip: track.codec === 'opus' ? opusPreSkip(header) : 0,
    vorbisShortBlock: track.codec === 'vorbis' ? vorbisShortBlockFrames(header) : 0,
  }
}

export async function trackTiming(src: MediaSourceLike, input: Input, track: InputAudioTrack): Promise<SourceTiming<EncodedPacket> | null> {
  const { EncodedPacketSink } = await import('mediabunny')
  const packets = new EncodedPacketSink(track)
  const first = await packets.getFirstPacket()
  if (!first) return null
  const facts = await readTimingFacts(src, input, track, first.timestamp).catch(() => null)
  return facts ? buildSourceTiming(facts, packets, first) : null
}

export async function sourceAudioSink(src: MediaSourceLike, input: Input, track: InputAudioTrack): Promise<Pick<AudioBufferSink, 'buffers'>> {
  const { AudioBufferSink } = await import('mediabunny')
  const sink = new AudioBufferSink(track)
  const timing = await trackTiming(src, input, track)
  return timing ? timedSink(sink, timing) : sink
}
