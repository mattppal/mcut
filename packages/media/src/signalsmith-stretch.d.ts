/**
 * Minimal typings for the official signalsmith-stretch web release (WASM +
 * AudioWorklet; no bundled types). Only the surface mcut uses is declared.
 */
declare module 'signalsmith-stretch' {
  export interface SignalsmithStretchSchedule {
    /** AudioContext output time the change applies at (seconds). */
    output?: number
    /** Position in the input buffer (seconds). */
    input?: number
    /** Playback rate (0.5 = half speed); pitch is preserved. */
    rate?: number
    /** Pitch shift in semitones. */
    semitones?: number
    /** Whether the node processes audio. */
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
