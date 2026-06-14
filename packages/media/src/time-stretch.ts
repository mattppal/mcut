import type { TimeMap } from '@mcut/timeline'
import { renderStretchOffline } from './signalsmith-offline'

/**
 * Pitch-preserving time-stretch for export audio.
 *
 * Preview already preserves pitch — media elements default
 * `preservesPitch = true` when `playbackRate` changes — so without this the
 * export would chipmunk where the preview didn't. Constant-speed clips
 * (linear two-keyframe timeMaps, which is everything setElementSpeed
 * produces, including its split halves) stretch through here; variable
 * ramps keep the per-buffer `playbackRate` fallback.
 *
 * Engine: Signalsmith Stretch (WASM, notably higher quality and faster than
 * phase-vocoder/WSOLA approaches), driven through the offline buffer driver
 * in signalsmith-offline.ts — no Web Audio required, so the same path runs
 * on the main thread, in workers, and under Bun tests. Failures reject and
 * the export falls back to per-buffer `playbackRate` at the call site.
 */

export interface ConstantSpeed {
  /** Source ms consumed per output ms. */
  rate: number
  /** First source offset (ms relative to trimStart) the map plays. */
  sourceStartOffsetMs: number
  /** Source ms consumed in total. */
  sourceSpanMs: number
}

/** The constant speed a timeMap encodes, or null when it's a ramp/freeze. */
export function constantSpeedOf(timeMap: TimeMap | undefined): ConstantSpeed | null {
  if (!timeMap || timeMap.length !== 2) return null
  const [from, to] = [timeMap[0]!, timeMap[1]!]
  if (from.timeMs !== 0) return null
  if (from.easing !== undefined && from.easing !== 'linear') return null
  const sourceSpanMs = to.value - from.value
  const outputMs = to.timeMs - from.timeMs
  if (sourceSpanMs <= 0 || outputMs <= 0) return null
  return { rate: sourceSpanMs / outputMs, sourceStartOffsetMs: from.value, sourceSpanMs }
}

export interface StereoData {
  left: Float32Array
  right: Float32Array
  /** PCM sample rate; drives the offline stretch render. */
  sampleRate: number
}

/**
 * Stretch stereo PCM by `tempo` (2 = twice as fast, half as long) with
 * pitch preserved. Output length ≈ input / tempo.
 */
export async function stretchStereo(data: StereoData, tempo: number): Promise<StereoData> {
  const inputFrames = data.left.length
  const expectedFrames = Math.max(1, Math.round(inputFrames / tempo))
  const [left, right] = await renderStretchOffline(
    [data.left, data.right],
    data.sampleRate,
    tempo,
    expectedFrames,
  )
  return { left: left!, right: right!, sampleRate: data.sampleRate }
}
