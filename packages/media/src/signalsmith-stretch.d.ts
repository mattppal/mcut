declare module 'signalsmith-stretch' {
  export interface SignalsmithStretchSchedule {
    output?: number
    input?: number
    rate?: number
    semitones?: number
    active?: boolean
  }

  export interface SignalsmithStretchNode extends AudioNode {
    addBuffers(channels: Float32Array[]): Promise<number>
    dropBuffers(toSeconds?: number): Promise<unknown>
    schedule(change: SignalsmithStretchSchedule): void
    start(when?: number, offset?: number, duration?: number): void
    stop(when?: number): void
    latency(): number
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    channelOptions?: AudioWorkletNodeOptions,
  ): Promise<SignalsmithStretchNode>
}
