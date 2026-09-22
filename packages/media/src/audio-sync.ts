import { inputFor, type MediaSourceLike } from './probe'
import { valueAt } from './value-at'

export interface SyncResult {
  offsetMs: number
  confidence: number
}

export interface AudioSyncOptions {
  windowS?: number
  maxLagS?: number
  rateHz?: number
  signal?: AbortSignal
}

export function crossCorrelateEnvelopes(a: Float32Array, b: Float32Array, maxLagBuckets: number): { lag: number; confidence: number } {
  const center = (env: Float32Array) => {
    let mean = 0
    for (const v of env) mean += v
    mean /= env.length || 1
    return env.map((v) => v - mean)
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
      const x = valueAt(ca, i)
      const y = valueAt(cb, j)
      dot += x * y
      na += x * x
      nb += y * y
    }
    const score = na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0
    if (score > best) {
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

export async function extractEnvelope(src: MediaSourceLike, { windowS = 60, rateHz = 100, signal }: AudioSyncOptions = {}): Promise<Float32Array | null> {
  const input = await inputFor(src)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const { AudioBufferSink } = await import('mediabunny')
    const buckets = Math.ceil(windowS * rateHz)
    const sums = new Float64Array(buckets)
    const counts = new Float64Array(buckets)
    const sink = new AudioBufferSink(track)
    for await (const { buffer, timestamp } of sink.buffers(0, windowS)) {
      signal?.throwIfAborted()
      const data = buffer.getChannelData(0)
      const sampleRate = buffer.sampleRate
      for (let i = 0; i < data.length; i += 4) {
        const t = timestamp + i / sampleRate
        const bucket = Math.floor(t * rateHz)
        if (bucket < 0 || bucket >= buckets) continue
        const sample = valueAt(data, i)
        sums[bucket] = valueAt(sums, bucket) + sample * sample
        counts[bucket] = valueAt(counts, bucket) + 1
      }
    }
    return Float32Array.from(sums, (sum, i) => {
      const count = valueAt(counts, i)
      return count > 0 ? Math.sqrt(sum / count) : 0
    })
  } finally {
    input.dispose()
  }
}

export async function findSyncOffsetMs(a: MediaSourceLike, b: MediaSourceLike, options: AudioSyncOptions = {}): Promise<SyncResult | null> {
  const rateHz = options.rateHz ?? 100
  const maxLagS = options.maxLagS ?? 30
  const [envA, envB] = await Promise.all([extractEnvelope(a, options), extractEnvelope(b, options)])
  if (!envA || !envB) return null
  const { lag, confidence } = crossCorrelateEnvelopes(envA, envB, Math.round(maxLagS * rateHz))
  return { offsetMs: Math.round((-lag * 1000) / rateHz), confidence }
}
