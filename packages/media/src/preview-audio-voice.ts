import type { AudioBufferSink } from 'mediabunny'
import type { TimeMap } from '@mcut/timeline'
import { scheduleSegmentSources } from './export-audio'
import { startNode, type AudibleSegment } from './export-audio-composite'
import { VoiceFeed, type FeedChunk } from './preview-audio-feed'
import {
  contextAt,
  planFeed,
  planWindow,
  sourceMapOf,
  timelineAt,
  type AudioAnchor,
  type LinearMap,
  type PlannedWindow,
  type WindowGate,
} from './preview-audio-plan'

export const START_LEAD_S = 0.025
export const LOOKAHEAD_S = 1
const WINDOW_S = 0.5
const RETRY_S = 1
const VOLUME_SMOOTHING_S = 0.01
const CURVE_STEP_S = 0.05
const MAX_CURVE_STEPS = 2000

type Sink = Pick<AudioBufferSink, 'buffers'>

export type SinkOf = (src: string) => Promise<Sink | null>

interface ScheduledOutput {
  node: AudioNode
  endS: number
}

interface FeedSource {
  kind: 'feed'
  map: LinearMap
  feed: Promise<VoiceFeed | null> | null
  startS: number
}

interface WindowSource {
  kind: 'windows'
  curve: TimeMap
  planned: number
}

export interface Voice {
  segment: AudibleSegment
  volumeKey: string
  gain: GainNode
  nextS: number
  busy: boolean
  retryAtS: number
  outputs: ScheduledOutput[]
  controller: AbortController
  source: FeedSource | WindowSource
}

function curveValue(curve: Float32Array, fraction: number): number {
  const position = Math.min(1, Math.max(0, fraction)) * (curve.length - 1)
  const index = Math.floor(position)
  const low = curve[index] ?? 0
  const high = curve[Math.min(curve.length - 1, index + 1)] ?? low
  return low + (high - low) * (position - index)
}

function programVolume(param: AudioParam, anchor: AudioAnchor, segment: AudibleSegment, nowS: number): void {
  param.cancelAndHoldAtTime(nowS)
  const curve = segment.volumeCurve
  if (!curve) {
    param.setTargetAtTime(segment.volume, nowS, VOLUME_SMOOTHING_S)
    return
  }
  const fromS = Math.max(nowS + VOLUME_SMOOTHING_S, contextAt(anchor, segment.startMs))
  const toS = contextAt(anchor, segment.startMs + segment.durationMs)
  if (toS <= fromS) return
  const steps = Math.min(MAX_CURVE_STEPS, Math.max(2, Math.ceil((toS - fromS) / CURVE_STEP_S) + 1))
  const values = new Float32Array(steps)
  for (let step = 0; step < steps; step++) {
    const localMs = timelineAt(anchor, fromS + ((toS - fromS) * step) / (steps - 1)) - segment.startMs
    values[step] = curveValue(curve, localMs / segment.durationMs)
  }
  param.setValueCurveAtTime(values, fromS, toS - fromS)
}

function programGate(param: AudioParam, gate: WindowGate): void {
  param.value = 0
  if (gate.fadeInS > 0) {
    param.setValueAtTime(0, gate.openS)
    param.linearRampToValueAtTime(1, gate.openS + gate.fadeInS)
  } else {
    param.setValueAtTime(1, gate.openS)
  }
  if (gate.closeS === null) return
  param.setValueAtTime(1, gate.closeS)
  param.linearRampToValueAtTime(0, gate.closeS + gate.fadeOutS)
}

export function createVoice(context: AudioContext, anchor: AudioAnchor, output: AudioNode, segment: AudibleSegment, volumeKey: string, nextS: number): Voice {
  const gain = context.createGain()
  gain.gain.value = segment.volumeCurve ? 0 : segment.volume
  programVolume(gain.gain, anchor, segment, context.currentTime)
  gain.connect(output)
  const map = sourceMapOf(segment)
  const source: Voice['source'] = map.kind === 'linear' ? { kind: 'feed', map, feed: null, startS: nextS } : { kind: 'windows', curve: map.timeMap, planned: 0 }
  return { segment, volumeKey, gain, nextS, busy: false, retryAtS: 0, outputs: [], controller: new AbortController(), source }
}

export function retuneVoice(voice: Voice, anchor: AudioAnchor, segment: AudibleSegment, volumeKey: string, nowS: number): void {
  voice.segment = segment
  voice.volumeKey = volumeKey
  programVolume(voice.gain.gain, anchor, segment, nowS)
}

export function dropVoice(voice: Voice): void {
  voice.controller.abort()
  voice.gain.disconnect()
  for (const output of voice.outputs) output.node.disconnect()
  voice.outputs = []
  if (voice.source.kind === 'feed') void voice.source.feed?.then((feed) => feed?.close())
}

export function pumpVoice(context: AudioContext, anchor: AudioAnchor, voice: Voice, sinkOf: SinkOf): void {
  const nowS = context.currentTime
  voice.outputs = voice.outputs.filter((output) => {
    if (output.endS >= nowS) return true
    output.node.disconnect()
    return false
  })
  if (voice.busy || nowS < voice.retryAtS || voice.nextS > nowS + LOOKAHEAD_S) return
  const endS = contextAt(anchor, voice.segment.startMs + voice.segment.durationMs)
  if (voice.nextS >= endS - 1e-6) return
  const toS = Math.min(voice.nextS + WINDOW_S, endS)
  const source = voice.source
  const rendering = source.kind === 'feed' ? streamFeed(context, anchor, voice, source, toS, sinkOf) : renderWindow(context, anchor, voice, source, toS, sinkOf)
  if (!rendering) return
  voice.nextS = toS
  voice.busy = true
  rendering
    .catch(() => {
      if (voice.controller.signal.aborted) return
      voice.retryAtS = context.currentTime + RETRY_S
      voice.nextS = Math.max(voice.nextS, voice.retryAtS + START_LEAD_S)
      if (source.kind !== 'feed') return
      void source.feed?.then((feed) => feed?.close())
      source.feed = null
    })
    .finally(() => {
      voice.busy = false
    })
}

function streamFeed(context: AudioContext, anchor: AudioAnchor, voice: Voice, source: FeedSource, toS: number, sinkOf: SinkOf): Promise<void> | null {
  const signal = voice.controller.signal
  if (!source.feed) {
    const planned = planFeed(voice.segment, source.map, anchor, voice.nextS)
    if (!planned) return null
    source.startS = planned.startS
    source.feed = sinkOf(voice.segment.src).then((sink) => (sink && !signal.aborted ? VoiceFeed.open(sink, planned.plan, signal) : null))
  }
  const opening = source.feed
  return (async () => {
    const feed = await opening
    if (!feed || signal.aborted) return
    const chunk = await feed.take(toS - source.startS, signal)
    if (!signal.aborted) play(context, voice, chunk, source.startS)
  })()
}

function play(context: AudioContext, voice: Voice, chunk: FeedChunk, startS: number): void {
  const length = chunk.channels[0]?.length ?? 0
  if (length === 0) return
  const buffer = context.createBuffer(chunk.channels.length, length, chunk.sampleRate)
  for (const [channel, data] of chunk.channels.entries()) buffer.getChannelData(channel).set(data)
  const node = context.createBufferSource()
  node.buffer = buffer
  node.connect(voice.gain)
  const whenS = startS + chunk.offsetS
  startNode(node, { whenS, offsetS: 0, durationS: buffer.duration })
  voice.outputs.push({ node, endS: whenS + buffer.duration })
}

function renderWindow(context: AudioContext, anchor: AudioAnchor, voice: Voice, source: WindowSource, toS: number, sinkOf: SinkOf): Promise<void> | null {
  const planned = planWindow(voice.segment, source.curve, anchor, voice.nextS, toS, source.planned > 0)
  if (!planned) return null
  source.planned++
  return scheduleWindow(context, voice, planned, sinkOf)
}

async function scheduleWindow(context: AudioContext, voice: Voice, planned: PlannedWindow, sinkOf: SinkOf): Promise<void> {
  const sink = await sinkOf(planned.segment.src)
  const signal = voice.controller.signal
  if (!sink || signal.aborted) return
  const gate = context.createGain()
  programGate(gate.gain, planned.gate)
  gate.connect(voice.gain)
  voice.outputs.push({ node: gate, endS: planned.endS })
  await scheduleSegmentSources(context, gate, sink, planned.segment, signal)
}
