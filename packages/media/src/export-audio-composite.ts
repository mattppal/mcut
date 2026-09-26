import type { AudioBufferSink } from 'mediabunny'
import type { ElementId, TimeMap } from '@mcut/timeline'
import { stretchStereo, type ConstantSpeed } from './time-stretch'

export interface AudibleSegment {
  elementId: ElementId
  src: string
  startMs: number
  durationMs: number
  trimStartMs: number
  sourceSpanMs: number
  timeMap?: TimeMap
  reversed?: boolean
  volume: number
  volumeCurve?: Float32Array
}

const MAX_STRETCH_SOURCE_FRAMES = 32_000_000
const REVERSED_CHUNK_FRAMES = 8_000_000
const DECODER_LEAD_FRAMES = 8_192

interface CompositeAudio {
  channels: Float32Array[]
  sampleRate: number
}

type CompositeDecode = { status: 'ready'; audio: CompositeAudio } | { status: 'empty' } | { status: 'too-long'; sampleRate: number; frames: number }

export interface ReversedChunkSpan {
  sourceFrame: number
  frames: number
  outputFrame: number
}

export function reversedChunkSpans(totalFrames: number, chunkFrames: number): ReversedChunkSpan[] {
  if (chunkFrames <= 0 || totalFrames <= 0) return []
  const spans: ReversedChunkSpan[] = []
  let outputFrame = 0
  while (outputFrame < totalFrames) {
    const frames = Math.min(chunkFrames, totalFrames - outputFrame)
    spans.push({ sourceFrame: totalFrames - outputFrame - frames, frames, outputFrame })
    outputFrame += frames
  }
  return spans
}

interface StereoComposite {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

function stereoOf(composite: CompositeAudio): StereoComposite {
  const [left = new Float32Array(0), second] = composite.channels
  return { left, right: second ?? left.slice(), sampleRate: composite.sampleRate }
}

type CompositeChannels = 'all' | 'stereo'

export function decoderLeadStart(startS: number, leadFrames: number, sampleRate: number): number {
  if (leadFrames <= 0 || startS <= 0 || sampleRate <= 0) return startS
  return Math.max(0, startS - leadFrames / sampleRate)
}

async function leadStart(sink: AudioBufferSink, startS: number, spanS: number, leadFrames: number, signal?: AbortSignal): Promise<number> {
  if (leadFrames <= 0 || startS <= 0) return startS
  let sampleRate = 0
  for await (const { buffer } of sink.buffers(startS, startS + spanS)) {
    signal?.throwIfAborted()
    sampleRate = buffer.sampleRate
    break
  }
  return decoderLeadStart(startS, leadFrames, sampleRate)
}

export async function decodeCompositeRange(
  sink: AudioBufferSink,
  startS: number,
  spanS: number,
  keep: CompositeChannels,
  signal?: AbortSignal,
  leadFrames = 0,
): Promise<CompositeDecode> {
  const decodeStart = await leadStart(sink, startS, spanS, leadFrames, signal)
  let composite: CompositeAudio | null = null
  for await (const { buffer, timestamp } of sink.buffers(decodeStart, startS + spanS)) {
    signal?.throwIfAborted()
    if (!composite) {
      const sampleRate = buffer.sampleRate
      const frames = Math.ceil(spanS * sampleRate)
      const sourceChannels = Math.max(1, buffer.numberOfChannels)
      const channelCount = keep === 'all' ? sourceChannels : Math.min(2, sourceChannels)
      const frameBudget = keep === 'all' ? (MAX_STRETCH_SOURCE_FRAMES * 2) / channelCount : MAX_STRETCH_SOURCE_FRAMES
      if (frames > frameBudget) return { status: 'too-long', sampleRate, frames }
      composite = {
        channels: Array.from({ length: channelCount }, () => new Float32Array(frames)),
        sampleRate,
      }
    }
    const origin = Math.round((timestamp - startS) * composite.sampleRate)
    const skip = Math.max(0, -origin)
    const offset = Math.max(0, origin)
    const frames = composite.channels[0]?.length ?? 0
    if (offset >= frames || skip >= buffer.length) continue
    const count = Math.min(buffer.length - skip, frames - offset)
    for (const [channel, target] of composite.channels.entries()) {
      if (channel >= buffer.numberOfChannels) break
      target.set(buffer.getChannelData(channel).subarray(skip, skip + count), offset)
    }
  }
  return composite ? { status: 'ready', audio: composite } : { status: 'empty' }
}

function scheduleBuffer(
  offline: OfflineAudioContext,
  gain: GainNode,
  channels: readonly Float32Array[],
  sampleRate: number,
  whenS: number,
  durationS: number,
): void {
  const length = channels[0]?.length ?? 0
  if (length === 0) return
  const out = offline.createBuffer(channels.length, length, sampleRate)
  for (const [channel, data] of channels.entries()) out.getChannelData(channel).set(data)
  const node = offline.createBufferSource()
  node.buffer = out
  node.connect(gain)
  node.start(whenS, 0, Math.min(out.duration, durationS))
}

export function scheduleComposite(
  offline: OfflineAudioContext,
  gain: GainNode,
  segment: AudibleSegment,
  channels: readonly Float32Array[],
  sampleRate: number,
): void {
  scheduleBuffer(offline, gain, channels, sampleRate, segment.startMs / 1000, segment.durationMs / 1000)
}

export async function scheduleStretchedSegment(
  offline: OfflineAudioContext,
  gain: GainNode,
  sink: AudioBufferSink,
  segment: AudibleSegment,
  constant: ConstantSpeed,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const startS = (segment.trimStartMs + constant.sourceStartOffsetMs) / 1000
    const composite = await decodeCompositeRange(sink, startS, constant.sourceSpanMs / 1000, 'stereo', signal)
    if (composite.status !== 'ready') return false

    const stretched = await stretchStereo(stereoOf(composite.audio), constant.rate)
    if (stretched.left.length === 0) return false

    scheduleComposite(offline, gain, segment, [stretched.left, stretched.right], composite.audio.sampleRate)
    return true
  } catch (error) {
    if (signal?.aborted) throw error
    return false
  }
}

function reversedLimitMessage(segment: AudibleSegment, sampleRate: number): string {
  const minutes = (MAX_STRETCH_SOURCE_FRAMES / sampleRate / 60).toFixed(1)
  return `Reversed audio longer than ${minutes} minutes is not supported yet (element ${segment.elementId}).`
}

async function scheduleReversedChunks(
  offline: OfflineAudioContext,
  gain: GainNode,
  sink: AudioBufferSink,
  segment: AudibleSegment,
  totalFrames: number,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<void> {
  const trimS = segment.trimStartMs / 1000
  const outputStartS = segment.startMs / 1000
  for (const span of reversedChunkSpans(totalFrames, REVERSED_CHUNK_FRAMES)) {
    signal?.throwIfAborted()
    const decoded = await decodeCompositeRange(sink, trimS + span.sourceFrame / sampleRate, span.frames / sampleRate, 'stereo', signal, DECODER_LEAD_FRAMES)
    switch (decoded.status) {
      case 'ready':
        for (const channel of decoded.audio.channels) channel.reverse()
        scheduleBuffer(offline, gain, decoded.audio.channels, decoded.audio.sampleRate, outputStartS + span.outputFrame / sampleRate, span.frames / sampleRate)
        break
      case 'empty':
        throw new Error(`Reversed audio produced no samples (element ${segment.elementId}).`)
      case 'too-long':
        throw new Error(reversedLimitMessage(segment, decoded.sampleRate))
      default: {
        const unhandled: never = decoded
        throw new Error(`Unknown reversed audio decode ${JSON.stringify(unhandled)}.`)
      }
    }
  }
}

export async function scheduleReversedSegment(
  offline: OfflineAudioContext,
  gain: GainNode,
  sink: AudioBufferSink,
  segment: AudibleSegment,
  signal?: AbortSignal,
): Promise<void> {
  const decoded = await decodeCompositeRange(sink, segment.trimStartMs / 1000, segment.sourceSpanMs / 1000, 'stereo', signal, DECODER_LEAD_FRAMES)
  switch (decoded.status) {
    case 'ready': {
      const composite = stereoOf(decoded.audio)
      composite.left.reverse()
      composite.right.reverse()
      const rate = segment.sourceSpanMs / Math.max(1, segment.durationMs)
      let { left, right } = composite
      if (Math.abs(rate - 1) > 1e-6) {
        const stretched = await stretchStereo(composite, rate)
        if (stretched.left.length === 0) throw new Error(`Reversed audio produced no samples (element ${segment.elementId}).`)
        left = stretched.left
        right = stretched.right
      }
      scheduleComposite(offline, gain, segment, [left, right], composite.sampleRate)
      return
    }
    case 'empty':
      throw new Error(`Reversed audio produced no samples (element ${segment.elementId}).`)
    case 'too-long': {
      const rate = segment.sourceSpanMs / Math.max(1, segment.durationMs)
      if (Math.abs(rate - 1) > 1e-6) throw new Error(reversedLimitMessage(segment, decoded.sampleRate))
      await scheduleReversedChunks(offline, gain, sink, segment, decoded.frames, decoded.sampleRate, signal)
      return
    }
    default: {
      const unhandled: never = decoded
      throw new Error(`Unknown reversed audio decode ${JSON.stringify(unhandled)}.`)
    }
  }
}
