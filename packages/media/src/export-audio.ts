import type { AudioBufferSink } from 'mediabunny'
import {
  getEffectiveVolume,
  hasFades,
  hasKeyframes,
  interpolateTrack,
  isMediaClip,
  resolveElementAudioSource,
  type Project,
  type TimeMap,
} from '@mcut/timeline'
import { inputFor } from './probe'
import { constantSpeedOf, stretchStereo, type ConstantSpeed } from './time-stretch'
import { AUDIO_SAMPLE_RATE, type MixedAudioData } from './export-types'
import { valueAt } from './value-at'

interface AudibleSegment {
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

interface RemapPlan {
  grid: Float64Array
  stepMs: number
}

function buildRemapPlan(timeMap: TimeMap, durationMs: number): RemapPlan {
  const stepMs = 10
  const steps = Math.max(2, Math.ceil(durationMs / stepMs) + 1)
  const grid = new Float64Array(steps)
  for (let i = 0; i < steps; i++) {
    grid[i] = interpolateTrack(timeMap, Math.min(durationMs, i * stepMs))
  }
  return { grid, stepMs }
}

function remapSourceToOutput(plan: RemapPlan, sourceOffsetMs: number): { outputMs: number; rate: number } | null {
  const { grid, stepMs } = plan
  const last = grid.length - 1
  if (sourceOffsetMs >= valueAt(grid, last)) {
    const seg = valueAt(grid, last) - valueAt(grid, last - 1)
    if (seg <= 1e-6) return null
    return { outputMs: last * stepMs, rate: seg / stepMs }
  }
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (valueAt(grid, mid) <= sourceOffsetMs) lo = mid
    else hi = mid
  }
  const seg = valueAt(grid, hi) - valueAt(grid, lo)
  if (seg <= 1e-6) return null
  const frac = (sourceOffsetMs - valueAt(grid, lo)) / seg
  return { outputMs: (lo + frac) * stepMs, rate: seg / stepMs }
}

function sampleVolumeCurve(element: { startMs: number; durationMs: number }, getValue: (timelineMs: number) => number): Float32Array {
  const steps = Math.min(2000, Math.max(2, Math.ceil(element.durationMs / 50) + 1))
  const curve = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const timelineMs = element.startMs + (i / (steps - 1)) * element.durationMs
    curve[i] = Math.max(0, getValue(timelineMs))
  }
  return curve
}

function collectAudibleSegments(project: Project): AudibleSegment[] {
  const segments: AudibleSegment[] = []
  for (const track of project.tracks) {
    if (track.muted) continue
    for (const element of track.elements) {
      if (!isMediaClip(element) || element.muted) continue
      const curved = hasKeyframes(element, 'volume') || hasFades(element)
      if (element.volume <= 0 && !curved) continue
      const source = resolveElementAudioSource(project, element.id)
      if (!source) continue
      segments.push({
        src: source.asset.src,
        startMs: source.timelineStartMs,
        durationMs: source.timelineDurationMs,
        trimStartMs: source.sourceStartMs,
        sourceSpanMs: source.sourceSpanMs,
        ...(source.timeMap ? { timeMap: source.timeMap } : {}),
        ...(source.reversed ? { reversed: true } : {}),
        volume: element.volume,
        ...(curved
          ? {
              volumeCurve: sampleVolumeCurve(element, (timelineMs) => getEffectiveVolume(element, timelineMs)),
            }
          : {}),
      })
    }
  }
  return segments
}

export async function mixProjectAudio(project: Project, totalDurationMs: number, signal?: AbortSignal): Promise<MixedAudioData | null> {
  const segments = collectAudibleSegments(project)
  if (segments.length === 0) return null
  const buffer = await mixAudioSegments(segments, totalDurationMs, signal)
  return {
    left: buffer.getChannelData(0),
    right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0),
    sampleRate: buffer.sampleRate,
  }
}

async function mixAudioSegments(segments: AudibleSegment[], totalDurationMs: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const length = Math.ceil((totalDurationMs / 1000) * AUDIO_SAMPLE_RATE)
  const offline = new OfflineAudioContext(2, length, AUDIO_SAMPLE_RATE)

  for (const segment of segments) {
    signal?.throwIfAborted()
    const input = await inputFor(segment.src)
    try {
      const track = await input.getPrimaryAudioTrack()
      if (!track) continue
      const { AudioBufferSink } = await import('mediabunny')
      const sink = new AudioBufferSink(track)
      const segmentStartS = segment.startMs / 1000
      const segmentEndS = (segment.startMs + segment.durationMs) / 1000
      const trimS = segment.trimStartMs / 1000

      const gain = offline.createGain()
      if (segment.volumeCurve) {
        gain.gain.setValueCurveAtTime(segment.volumeCurve, segmentStartS, segment.durationMs / 1000)
      } else {
        gain.gain.value = segment.volume
      }
      gain.connect(offline.destination)

      if (segment.reversed) {
        await scheduleReversedSegment(offline, gain, sink, segment, signal)
        continue
      }

      // Media elements keep pitch across playbackRate changes per https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch so the export stretch does too
      const constant = constantSpeedOf(segment.timeMap)
      if (constant && Math.abs(constant.rate - 1) > 1e-6) {
        const stretched = await scheduleStretchedSegment(offline, gain, sink, segment, constant, signal)
        if (stretched) continue
      }

      const plan = segment.timeMap ? buildRemapPlan(segment.timeMap, segment.durationMs) : null

      for await (const { buffer, timestamp } of sink.buffers(trimS, trimS + segment.sourceSpanMs / 1000)) {
        signal?.throwIfAborted()
        let rate = 1
        let when: number
        if (plan) {
          const remapped = remapSourceToOutput(plan, (timestamp - trimS) * 1000)
          if (!remapped || remapped.rate <= 0.01) continue
          rate = remapped.rate
          when = segmentStartS + remapped.outputMs / 1000
        } else {
          when = segmentStartS + (timestamp - trimS)
        }
        let offset = 0
        if (when < segmentStartS) {
          offset = (segmentStartS - when) * rate
          when = segmentStartS
        }
        const playDuration = Math.min(buffer.duration - offset, (segmentEndS - when) * rate)
        if (playDuration <= 0) continue
        const node = offline.createBufferSource()
        node.buffer = buffer
        node.playbackRate.value = rate
        node.connect(gain)
        node.start(when, offset, playDuration)
      }
    } finally {
      input.dispose()
    }
  }

  return offline.startRendering()
}

const MAX_STRETCH_SOURCE_FRAMES = 32_000_000

interface CompositeAudio {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

async function decodeCompositeRange(sink: AudioBufferSink, startS: number, spanS: number, signal?: AbortSignal): Promise<CompositeAudio | null> {
  let composite: CompositeAudio | null = null
  for await (const { buffer, timestamp } of sink.buffers(startS, startS + spanS)) {
    signal?.throwIfAborted()
    if (!composite) {
      const sampleRate = buffer.sampleRate
      const frames = Math.ceil(spanS * sampleRate)
      if (frames > MAX_STRETCH_SOURCE_FRAMES) return null
      composite = {
        left: new Float32Array(frames),
        right: new Float32Array(frames),
        sampleRate,
      }
    }
    const offset = Math.max(0, Math.round((timestamp - startS) * composite.sampleRate))
    if (offset >= composite.left.length) continue
    const left = buffer.getChannelData(0)
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
    const count = Math.min(left.length, composite.left.length - offset)
    composite.left.set(count === left.length ? left : left.subarray(0, count), offset)
    composite.right.set(count === right.length ? right : right.subarray(0, count), offset)
  }
  return composite
}

function scheduleComposite(
  offline: OfflineAudioContext,
  gain: GainNode,
  segment: AudibleSegment,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): void {
  const out = offline.createBuffer(2, left.length, sampleRate)
  out.getChannelData(0).set(left)
  out.getChannelData(1).set(right)
  const node = offline.createBufferSource()
  node.buffer = out
  node.connect(gain)
  node.start(segment.startMs / 1000, 0, Math.min(out.duration, segment.durationMs / 1000))
}

async function scheduleStretchedSegment(
  offline: OfflineAudioContext,
  gain: GainNode,
  sink: AudioBufferSink,
  segment: AudibleSegment,
  constant: ConstantSpeed,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const startS = (segment.trimStartMs + constant.sourceStartOffsetMs) / 1000
    const composite = await decodeCompositeRange(sink, startS, constant.sourceSpanMs / 1000, signal)
    if (!composite) return false

    const stretched = await stretchStereo(composite, constant.rate)
    if (stretched.left.length === 0) return false

    scheduleComposite(offline, gain, segment, stretched.left, stretched.right, composite.sampleRate)
    return true
  } catch (error) {
    if (signal?.aborted) throw error
    return false
  }
}

async function scheduleReversedSegment(
  offline: OfflineAudioContext,
  gain: GainNode,
  sink: AudioBufferSink,
  segment: AudibleSegment,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const composite = await decodeCompositeRange(sink, segment.trimStartMs / 1000, segment.sourceSpanMs / 1000, signal)
    if (!composite) return false
    composite.left.reverse()
    composite.right.reverse()

    const rate = segment.sourceSpanMs / Math.max(1, segment.durationMs)
    let { left, right } = composite
    if (Math.abs(rate - 1) > 1e-6) {
      const stretched = await stretchStereo(composite, rate)
      if (stretched.left.length === 0) return false
      left = stretched.left
      right = stretched.right
    }
    scheduleComposite(offline, gain, segment, left, right, composite.sampleRate)
    return true
  } catch (error) {
    if (signal?.aborted) throw error
    return false
  }
}
