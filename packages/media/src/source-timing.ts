import type { AudioBufferSink, AudioCodec } from 'mediabunny'

export interface TimedPacket {
  timestamp: number
  data: Uint8Array
}

export interface PacketIndex<P extends TimedPacket> {
  getFirstPacket(): Promise<P | null>
  getKeyPacket(timestamp: number, options: { verifyKeyPackets: boolean }): Promise<P | null>
  getNextPacket(packet: P): Promise<P | null>
}

export interface TimingFacts {
  container: 'mp3' | 'isobmff' | 'matroska' | 'ogg' | 'other'
  codec: AudioCodec | null
  sampleRate: number
  resolution: number
  leadFrames: number
  preSkip: number
  vorbisShortBlock: number
}

export interface SourceTiming<P extends TimedPacket> {
  facts: TimingFacts
  packets: PacketIndex<P>
  first: P
}

export async function buildSourceTiming<P extends TimedPacket>(facts: TimingFacts, packets: PacketIndex<P>, first: P): Promise<SourceTiming<P>> {
  return { facts, packets, first }
}

export function timedSink<P extends TimedPacket>(sink: Pick<AudioBufferSink, 'buffers'>, _timing: SourceTiming<P>): Pick<AudioBufferSink, 'buffers'> {
  return sink
}
