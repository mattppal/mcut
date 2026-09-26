import type { AudioBufferSink, WrappedAudioBuffer } from 'mediabunny'
import { decodeCompositeRange, leadStart } from './export-audio-composite'
import { StretchStream } from './signalsmith-offline'

type Sink = Pick<AudioBufferSink, 'buffers'>

export interface FeedPlan {
  reversed: boolean
  sourceS: number
  spanS: number
  prerollS: number
  tempo: number
}

interface SourceReader {
  readonly sampleRate: number
  readonly channelCount: number
  read(frames: number, signal: AbortSignal): Promise<Float32Array[]>
  close(): void
}

class ForwardReader implements SourceReader {
  private emitted = 0
  private filled = 0
  private pending: Float32Array[]
  private done = false

  private constructor(
    private readonly iterator: AsyncIterator<WrappedAudioBuffer>,
    private readonly startS: number,
    private readonly totalFrames: number,
    readonly sampleRate: number,
    readonly channelCount: number,
    first: WrappedAudioBuffer,
  ) {
    this.pending = Array.from({ length: channelCount }, () => new Float32Array(0))
    this.place(first)
  }

  static async open(sink: Sink, startS: number, spanS: number, keepAll: boolean, signal: AbortSignal): Promise<ForwardReader | null> {
    const iterator = sink.buffers(await leadStart(sink, startS, spanS, signal), startS + spanS)[Symbol.asyncIterator]()
    const first = await iterator.next()
    signal.throwIfAborted()
    if (first.done) return null
    const { buffer } = first.value
    const channelCount = keepAll ? Math.max(1, buffer.numberOfChannels) : Math.min(2, Math.max(1, buffer.numberOfChannels))
    return new ForwardReader(iterator, startS, Math.ceil(spanS * buffer.sampleRate), buffer.sampleRate, channelCount, first.value)
  }

  async read(frames: number, signal: AbortSignal): Promise<Float32Array[]> {
    const until = Math.min(this.totalFrames, this.emitted + frames)
    while (!this.done && this.filled < until) {
      const next = await this.iterator.next()
      signal.throwIfAborted()
      if (next.done) this.done = true
      else this.place(next.value)
    }
    const ready = Math.min(frames, Math.max(0, this.filled - this.emitted))
    const out = this.pending.map((lane) => {
      const chunk = new Float32Array(frames)
      chunk.set(lane.subarray(0, ready))
      return chunk
    })
    this.pending = this.pending.map((lane) => lane.slice(frames))
    this.emitted += frames
    this.filled = Math.max(this.filled, this.emitted)
    return out
  }

  close(): void {
    void this.iterator.return?.()
  }

  private place({ buffer, timestamp }: WrappedAudioBuffer): void {
    const origin = Math.round((timestamp - this.startS) * this.sampleRate)
    const from = Math.max(origin, this.emitted)
    const to = Math.min(origin + buffer.length, this.totalFrames)
    if (to <= from) return
    const end = Math.max(this.filled, to)
    if (end - this.emitted > (this.pending[0]?.length ?? 0)) {
      this.pending = this.pending.map((lane) => {
        const grown = new Float32Array(Math.max(end - this.emitted, lane.length * 2))
        grown.set(lane)
        return grown
      })
    }
    for (const [channel, lane] of this.pending.entries()) {
      const data = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
      lane.set(data.subarray(from - origin, to - origin), from - this.emitted)
    }
    this.filled = end
  }
}

class ReversedReader implements SourceReader {
  private emitted = 0

  private constructor(
    private readonly sink: Sink,
    private readonly highS: number,
    private readonly totalFrames: number,
    readonly sampleRate: number,
    readonly channelCount: number,
  ) {}

  static async open(sink: Sink, highS: number, spanS: number, signal: AbortSignal): Promise<ReversedReader | null> {
    const probe = await decodeCompositeRange(sink, Math.max(0, highS - 0.01), Math.min(0.01, highS), 'stereo', signal)
    if (probe.status !== 'ready') return null
    const { sampleRate, channels } = probe.audio
    return new ReversedReader(sink, highS, Math.round(spanS * sampleRate), sampleRate, channels.length)
  }

  async read(frames: number, signal: AbortSignal): Promise<Float32Array[]> {
    const out = Array.from({ length: this.channelCount }, () => new Float32Array(frames))
    const count = Math.min(frames, this.totalFrames - this.emitted)
    if (count > 0) {
      const lowFrame = this.emitted + count
      const decoded = await decodeCompositeRange(this.sink, this.highS - lowFrame / this.sampleRate, count / this.sampleRate, 'stereo', signal)
      if (decoded.status === 'ready') {
        for (const [channel, lane] of out.entries()) {
          const data = decoded.audio.channels[Math.min(channel, decoded.audio.channels.length - 1)] ?? new Float32Array(0)
          lane.set(data.subarray(0, count).reverse())
        }
      }
    }
    this.emitted += frames
    return out
  }

  close(): void {}
}

export interface FeedChunk {
  channels: Float32Array[]
  sampleRate: number
  offsetS: number
}

export class VoiceFeed {
  private delivered = 0
  private appended = 0
  private discardFrames: number

  private constructor(
    private readonly reader: SourceReader,
    private readonly stream: StretchStream | null,
    prerollFrames: number,
  ) {
    this.discardFrames = prerollFrames
  }

  static async open(sink: Sink, plan: FeedPlan, signal: AbortSignal): Promise<VoiceFeed | null> {
    const stretched = Math.abs(plan.tempo - 1) > 1e-6
    const prerollS = stretched ? plan.prerollS : 0
    const reader = plan.reversed
      ? await ReversedReader.open(sink, plan.sourceS + prerollS, plan.spanS + prerollS, signal)
      : await ForwardReader.open(sink, plan.sourceS - prerollS, plan.spanS + prerollS, !stretched, signal)
    if (!reader) return null
    if (!stretched) return new VoiceFeed(reader, null, 0)
    try {
      const stream = await StretchStream.open(2, reader.sampleRate, plan.tempo)
      signal.throwIfAborted()
      return new VoiceFeed(reader, stream, Math.round((prerollS / plan.tempo) * reader.sampleRate))
    } catch (error) {
      reader.close()
      throw error
    }
  }

  async take(untilS: number, signal: AbortSignal): Promise<FeedChunk> {
    const { sampleRate } = this.reader
    const offsetS = this.delivered / sampleRate
    const frames = Math.max(0, Math.round(untilS * sampleRate) - this.delivered)
    this.delivered += frames
    const channels = this.stream ? await this.stretched(this.stream, frames, signal) : await this.reader.read(frames, signal)
    return { channels, sampleRate, offsetS }
  }

  close(): void {
    this.reader.close()
  }

  private async stretched(stream: StretchStream, frames: number, signal: AbortSignal): Promise<Float32Array[]> {
    const needed = stream.inputFramesFor(this.discardFrames + frames)
    if (needed > this.appended) {
      const [left = new Float32Array(0), right = left] = await this.reader.read(needed - this.appended, signal)
      stream.append([left, right])
      this.appended = needed
    }
    if (this.discardFrames > 0) {
      stream.render(this.discardFrames)
      this.discardFrames = 0
    }
    return stream.render(frames)
  }
}
