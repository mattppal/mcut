import { AudioBufferSink } from 'mediabunny'
import {
  getEffectiveVolume,
  getMulticamAudioSource,
  getSourceSpanMs,
  hasFades,
  hasKeyframes,
  interpolateTrack,
  type Project,
  type TimeMap,
} from '@mcut/timeline'
import { inputFor } from './probe'
import { constantSpeedOf, stretchStereo, type ConstantSpeed } from './time-stretch'
import { AUDIO_SAMPLE_RATE, type MixedAudioData } from './export-types'

/**
 * The export audio mix. This phase stays on the MAIN thread: it renders
 * through `OfflineAudioContext` (and the Signalsmith time-stretch worklet),
 * which don't exist in workers. The result is transferable planar PCM that
 * the worker encodes.
 */

interface AudibleSegment {
  src: string
  startMs: number
  durationMs: number
  trimStartMs: number
  /** Source ms consumed (last timeMap value, or durationMs at 1x). */
  sourceSpanMs: number
  /** Time remap; absent = 1x. */
  timeMap?: TimeMap
  /** Play the source span backward (samples reversed before scheduling). */
  reversed?: boolean
  volume: number
  /** Sampled animated volume + fades across the segment (overrides `volume`). */
  volumeCurve?: Float32Array
}

/**
 * Output→source samples of a segment's timeMap on a fixed grid, for inverting
 * (source buffer timestamp → output schedule time) and per-buffer playback
 * rate. 10ms steps keep ramps smooth at decoded-buffer granularity.
 */
interface RemapPlan {
  /** Source offset (ms, relative to trim) at output step i. */
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

/**
 * Where (output ms) and how fast (source-ms per output-ms) a source offset
 * plays. Returns null inside freezes — frozen spans consume no source audio.
 */
function remapSourceToOutput(
  plan: RemapPlan,
  sourceOffsetMs: number,
): { outputMs: number; rate: number } | null {
  const { grid, stepMs } = plan
  const last = grid.length - 1
  if (sourceOffsetMs >= grid[last]!) {
    const seg = grid[last]! - grid[last - 1]!
    if (seg <= 1e-6) return null
    return { outputMs: last * stepMs, rate: seg / stepMs }
  }
  // Lower bound: first index whose grid value exceeds the source offset.
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (grid[mid]! <= sourceOffsetMs) lo = mid
    else hi = mid
  }
  const seg = grid[hi]! - grid[lo]!
  if (seg <= 1e-6) return null
  const frac = (sourceOffsetMs - grid[lo]!) / seg
  return { outputMs: (lo + frac) * stepMs, rate: seg / stepMs }
}

/** Sample an armed volume track into a Web Audio value curve (~50ms steps). */
function sampleVolumeCurve(
  element: { startMs: number; durationMs: number },
  getValue: (timelineMs: number) => number,
): Float32Array {
  const steps = Math.min(2000, Math.max(2, Math.ceil(element.durationMs / 50) + 1))
  const curve = new Float32Array(steps)
  for (let i = 0; i < steps; i++) {
    const timelineMs = element.startMs + (i / (steps - 1)) * element.durationMs
    curve[i] = Math.max(0, getValue(timelineMs))
  }
  return curve
}

export function collectAudibleSegments(project: Project): AudibleSegment[] {
  const segments: AudibleSegment[] = []
  for (const track of project.tracks) {
    if (track.muted) continue
    for (const element of track.elements) {
      if (element.type === 'multicam' && !element.muted) {
        const source = getMulticamAudioSource(element)
        const asset = source ? project.assets[source.assetId] : undefined
        if (!source || !asset) continue
        // Keyframed volume and fades both vary over time → sample a curve of
        // the effective volume (the same seam the preview pool plays).
        const curved = hasKeyframes(element, 'volume') || hasFades(element)
        if (element.volume <= 0 && !curved) continue
        segments.push({
          src: asset.src,
          startMs: element.startMs,
          durationMs: element.durationMs,
          trimStartMs: source.trimStartMs,
          sourceSpanMs: getSourceSpanMs(element),
          ...(element.timeMap ? { timeMap: element.timeMap } : {}),
          volume: element.volume,
          ...(curved
            ? {
                volumeCurve: sampleVolumeCurve(element, (timelineMs) =>
                  getEffectiveVolume(element, timelineMs),
                ),
              }
            : {}),
        })
        continue
      }
      if ((element.type !== 'video' && element.type !== 'audio') || element.muted) continue
      const curved = hasKeyframes(element, 'volume') || hasFades(element)
      if (element.volume <= 0 && !curved) continue
      const asset = project.assets[element.assetId]
      if (!asset) continue
      segments.push({
        src: asset.src,
        startMs: element.startMs,
        durationMs: element.durationMs,
        trimStartMs: element.trimStartMs,
        sourceSpanMs: getSourceSpanMs(element),
        ...(element.timeMap ? { timeMap: element.timeMap } : {}),
        ...(element.reversed ? { reversed: true } : {}),
        volume: element.volume,
        ...(curved
          ? {
              volumeCurve: sampleVolumeCurve(element, (timelineMs) =>
                getEffectiveVolume(element, timelineMs),
              ),
            }
          : {}),
      })
    }
  }
  return segments
}

/**
 * Mix every audible segment offline and return transferable planar stereo
 * PCM, or null when the project has no audible segments. Main-thread only.
 */
export async function mixProjectAudio(
  project: Project,
  totalDurationMs: number,
  signal?: AbortSignal,
): Promise<MixedAudioData | null> {
  const segments = collectAudibleSegments(project)
  if (segments.length === 0) return null
  const buffer = await mixAudioSegments(segments, totalDurationMs, signal)
  return {
    left: buffer.getChannelData(0),
    right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0),
    sampleRate: buffer.sampleRate,
  }
}

async function mixAudioSegments(
  segments: AudibleSegment[],
  totalDurationMs: number,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const length = Math.ceil((totalDurationMs / 1000) * AUDIO_SAMPLE_RATE)
  const offline = new OfflineAudioContext(2, length, AUDIO_SAMPLE_RATE)

  for (const segment of segments) {
    signal?.throwIfAborted()
    const input = inputFor(segment.src)
    try {
      const track = await input.getPrimaryAudioTrack()
      if (!track) continue
      const sink = new AudioBufferSink(track)
      const segmentStartS = segment.startMs / 1000
      const segmentEndS = (segment.startMs + segment.durationMs) / 1000
      const trimS = segment.trimStartMs / 1000

      const gain = offline.createGain()
      if (segment.volumeCurve) {
        // Animated volume: linear value curve sampled from the keyframe track.
        gain.gain.setValueCurveAtTime(segment.volumeCurve, segmentStartS, segment.durationMs / 1000)
      } else {
        gain.gain.value = segment.volume
      }
      gain.connect(offline.destination)

      // Reversed clips: decode the whole source span, flip the samples, and
      // schedule one node (stretched when the clip is also speed-changed).
      // On failure the segment stays silent — playing it forward would be
      // worse than missing audio.
      if (segment.reversed) {
        await scheduleReversedSegment(offline, gain, sink, segment, signal)
        continue
      }

      // Constant-speed clips get pitch-preserving time-stretch (matches the
      // preview, where media elements keep pitch). Ramps fall through to the
      // per-buffer playbackRate path below.
      const constant = constantSpeedOf(segment.timeMap)
      if (constant && Math.abs(constant.rate - 1) > 1e-6) {
        const stretched = await scheduleStretchedSegment(offline, gain, sink, segment, constant, signal)
        if (stretched) continue
      }

      const plan = segment.timeMap ? buildRemapPlan(segment.timeMap, segment.durationMs) : null

      for await (const { buffer, timestamp } of sink.buffers(trimS, trimS + segment.sourceSpanMs / 1000)) {
        signal?.throwIfAborted()
        // Per-buffer constant rate: decoded buffers are tens of ms, so ramps
        // stay smooth. On this fallback path pitch follows speed (constant
        // -speed clips were already handled with pitch preserved above).
        let rate = 1
        let when: number
        if (plan) {
          const remapped = remapSourceToOutput(plan, (timestamp - trimS) * 1000)
          if (!remapped || remapped.rate <= 0.01) continue // frozen: no source consumed
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
        // start()'s offset/duration are in buffer (source) time; the output
        // window it occupies is duration / rate.
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

/** Source-frame ceiling for whole-segment stretching (~11 min at 48kHz). */
const MAX_STRETCH_SOURCE_FRAMES = 32_000_000

interface CompositeAudio {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

/**
 * Decode a contiguous source range into one stereo buffer. Returns null when
 * the range is too large (see {@link MAX_STRETCH_SOURCE_FRAMES}) or yields
 * no buffers.
 */
async function decodeCompositeRange(
  sink: AudioBufferSink,
  startS: number,
  spanS: number,
  signal?: AbortSignal,
): Promise<CompositeAudio | null> {
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

/** Wrap a composite in an AudioBuffer and schedule it across the segment. */
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

/**
 * Decode a constant-speed segment's full source range, time-stretch it with
 * pitch preserved, and schedule it as one node. Returns false (caller falls
 * back to per-buffer playbackRate) when the range is too large or decoding
 * misbehaves.
 */
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

/**
 * Decode a reversed segment's full source span, flip the samples, and
 * schedule it as one node — pitch-preserving stretch when the clip is also
 * speed-changed. Speed RAMPS on reversed clips render at their average rate
 * (a v1 limit). Returns false when decoding misbehaves; the caller leaves
 * the segment silent rather than playing it forward.
 */
async function scheduleReversedSegment(
  offline: OfflineAudioContext,
  gain: GainNode,
  sink: AudioBufferSink,
  segment: AudibleSegment,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const composite = await decodeCompositeRange(
      sink,
      segment.trimStartMs / 1000,
      segment.sourceSpanMs / 1000,
      signal,
    )
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
