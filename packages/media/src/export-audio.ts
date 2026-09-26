import type { AudioBufferSink } from 'mediabunny'
import {
  getEffectiveVolume,
  hasFades,
  hasKeyframes,
  interpolateTrack,
  isMediaClip,
  resolveElementAudioSource,
  type ElementId,
  type Project,
  type TimeMap,
} from '@mcut/timeline'
import {
  decodeCompositeRange,
  leadStart,
  scheduleComposite,
  scheduleReversedSegment,
  scheduleStretchedSegment,
  startNode,
  type AudibleSegment,
} from './export-audio-composite'
import { AUDIO_SAMPLE_RATE, type MixedAudioData } from './export-types'
import { inputFor } from './probe'
import { sourceAudioSink } from './source-timing'
import { constantSpeedOf } from './time-stretch'
import { valueAt } from './value-at'

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

export function collectAudibleSegments(project: Project, audioSources?: ReadonlyMap<ElementId, string>): AudibleSegment[] {
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
        elementId: element.id,
        src: audioSources?.get(element.id) ?? source.asset.src,
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

export async function mixProjectAudio(
  project: Project,
  totalDurationMs: number,
  signal?: AbortSignal,
  audioSources?: ReadonlyMap<ElementId, string>,
): Promise<MixedAudioData | null> {
  const segments = collectAudibleSegments(project, audioSources)
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
      const sink = await sourceAudioSink(segment.src, input, track)
      const gain = offline.createGain()
      if (segment.volumeCurve) {
        gain.gain.setValueCurveAtTime(segment.volumeCurve, segment.startMs / 1000, segment.durationMs / 1000)
      } else {
        gain.gain.value = segment.volume
      }
      gain.connect(offline.destination)
      await scheduleSegmentSources(offline, gain, sink, segment, signal)
    } finally {
      input.dispose()
    }
  }

  return offline.startRendering()
}

export async function scheduleSegmentSources(
  context: BaseAudioContext,
  destination: AudioNode,
  sink: Pick<AudioBufferSink, 'buffers'>,
  segment: AudibleSegment,
  signal?: AbortSignal,
): Promise<void> {
  const segmentStartS = segment.startMs / 1000
  const segmentEndS = (segment.startMs + segment.durationMs) / 1000
  const trimS = segment.trimStartMs / 1000

  if (segment.reversed) {
    await scheduleReversedSegment(context, destination, sink, segment, signal)
    return
  }

  // Media elements keep pitch across playbackRate changes per https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch so the export stretch does too
  const constant = constantSpeedOf(segment.timeMap)
  if (constant && Math.abs(constant.rate - 1) > 1e-6) {
    const stretched = await scheduleStretchedSegment(context, destination, sink, segment, constant, signal)
    if (stretched) return
  }

  const plan = segment.timeMap ? buildRemapPlan(segment.timeMap, segment.durationMs) : null
  if (!plan) {
    const composite = await decodeCompositeRange(sink, trimS, segment.sourceSpanMs / 1000, 'all', signal)
    if (composite.status === 'ready') {
      scheduleComposite(context, destination, segment, composite.audio.channels, composite.audio.sampleRate)
      return
    }
  }

  const decodeStartS = await leadStart(sink, trimS, segment.sourceSpanMs / 1000, signal)
  for await (const { buffer, timestamp } of sink.buffers(decodeStartS, trimS + segment.sourceSpanMs / 1000)) {
    signal?.throwIfAborted()
    if (Math.round((trimS - timestamp) * buffer.sampleRate) >= buffer.length) continue
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
    const node = context.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = rate
    node.connect(destination)
    startNode(node, { whenS: when, offsetS: offset, durationS: playDuration })
  }
}
