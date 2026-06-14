import { AudioBufferSink } from 'mediabunny'
import { inputFor, type MediaSourceLike } from './probe'

/**
 * Audio-waveform autosync for multicam: two recordings of the same room
 * align where their loudness envelopes correlate best. RMS envelopes at
 * 100Hz (10ms buckets) give talking-head-grade sync; normalized
 * cross-correlation over a bounded lag search finds the offset, and the
 * peak-vs-noise ratio doubles as a confidence score.
 */

export interface SyncResult {
  /** How much B starts AFTER A in real time (negative = B started first). */
  offsetMs: number
  /** Peak correlation ÷ runner-up — <1.3 means "don't trust this". */
  confidence: number
}

export interface AudioSyncOptions {
  /** Seconds of audio analyzed from each source. Default 60. */
  windowS?: number
  /** Largest |offset| considered, in seconds. Default 30. */
  maxLagS?: number
  /** Envelope rate (buckets per second). Default 100 (10ms resolution). */
  rateHz?: number
  signal?: AbortSignal
}

/**
 * Normalized cross-correlation of two zero-meaned envelopes. Returns the lag
 * (in buckets) that best aligns `b` to `a`: positive lag means b's content
 * happens LATER in its own file, i.e. b started recording earlier.
 * Pure — unit-testable without decoding.
 */
export function crossCorrelateEnvelopes(
  a: Float32Array,
  b: Float32Array,
  maxLagBuckets: number,
): { lag: number; confidence: number } {
  const center = (env: Float32Array) => {
    let mean = 0
    for (const v of env) mean += v
    mean /= env.length || 1
    const out = new Float32Array(env.length)
    for (let i = 0; i < env.length; i++) out[i] = env[i]! - mean
    return out
  }
  const ca = center(a)
  const cb = center(b)

  let bestLag = 0
  let best = -Infinity
  let secondBest = -Infinity
  for (let lag = -maxLagBuckets; lag <= maxLagBuckets; lag++) {
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < ca.length; i++) {
      const j = i + lag
      if (j < 0 || j >= cb.length) continue
      dot += ca[i]! * cb[j]!
      na += ca[i]! * ca[i]!
      nb += cb[j]! * cb[j]!
    }
    const score = na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0
    if (score > best) {
      // Runner-up must be a genuinely different alignment, not the peak's shoulder.
      if (Math.abs(lag - bestLag) > 4) secondBest = best
      best = score
      bestLag = lag
    } else if (score > secondBest && Math.abs(lag - bestLag) > 4) {
      secondBest = score
    }
  }
  const confidence = secondBest > 0 ? best / secondBest : best > 0 ? 99 : 0
  return { lag: bestLag, confidence }
}

/** RMS envelope of the first `windowS` seconds at `rateHz` buckets/second. */
export async function extractEnvelope(
  src: MediaSourceLike,
  { windowS = 60, rateHz = 100, signal }: AudioSyncOptions = {},
): Promise<Float32Array | null> {
  const input = inputFor(src)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const buckets = Math.ceil(windowS * rateHz)
    const sums = new Float64Array(buckets)
    const counts = new Float64Array(buckets)
    const sink = new AudioBufferSink(track)
    for await (const { buffer, timestamp } of sink.buffers(0, windowS)) {
      signal?.throwIfAborted()
      const data = buffer.getChannelData(0)
      const sampleRate = buffer.sampleRate
      for (let i = 0; i < data.length; i += 4) {
        // Every 4th sample is plenty for a 10ms RMS envelope.
        const t = timestamp + i / sampleRate
        const bucket = Math.floor(t * rateHz)
        if (bucket < 0 || bucket >= buckets) continue
        sums[bucket]! += data[i]! * data[i]!
        counts[bucket]! += 1
      }
    }
    const envelope = new Float32Array(buckets)
    for (let i = 0; i < buckets; i++) {
      envelope[i] = counts[i]! > 0 ? Math.sqrt(sums[i]! / counts[i]!) : 0
    }
    return envelope
  } finally {
    input.dispose()
  }
}

/**
 * The sync offset between two recordings: how many ms after A's recording
 * started did B's start. Null when either source has no audio.
 */
export async function findSyncOffsetMs(
  a: MediaSourceLike,
  b: MediaSourceLike,
  options: AudioSyncOptions = {},
): Promise<SyncResult | null> {
  const rateHz = options.rateHz ?? 100
  const maxLagS = options.maxLagS ?? 30
  const [envA, envB] = await Promise.all([
    extractEnvelope(a, options),
    extractEnvelope(b, options),
  ])
  if (!envA || !envB) return null
  const { lag, confidence } = crossCorrelateEnvelopes(envA, envB, Math.round(maxLagS * rateHz))
  // lag > 0 ⇒ b's matching content sits later in b's file ⇒ b STARTED EARLIER
  // by lag buckets ⇒ offset (B after A) is negative.
  return { offsetMs: Math.round((-lag * 1000) / rateHz), confidence }
}
