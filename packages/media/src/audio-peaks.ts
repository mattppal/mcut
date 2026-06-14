import { AudioBufferSink } from 'mediabunny'
import { inputFor, type MediaSourceLike } from './probe'

export interface AudioPeaksOptions {
  /** Number of peak buckets across the range. Default 256. */
  buckets?: number
  /** Source range. Defaults to the whole file. */
  startMs?: number
  endMs?: number
}

export interface AudioPeaks {
  /** Max |sample| per bucket, 0–1. */
  peaks: Float32Array
  durationMs: number
}

/** Fold samples into `buckets` max-|amplitude| bins (pure; unit-tested). */
export function bucketPeaks(samples: Float32Array, buckets: number): Float32Array {
  const peaks = new Float32Array(Math.max(1, buckets))
  if (samples.length === 0) return peaks
  const perBucket = samples.length / peaks.length
  for (let i = 0; i < samples.length; i++) {
    const bucket = Math.min(peaks.length - 1, Math.floor(i / perBucket))
    const value = Math.abs(samples[i]!)
    if (value > peaks[bucket]!) peaks[bucket] = value
  }
  return peaks
}

/**
 * Decode a file's audio and reduce it to waveform peaks for timeline clip
 * rendering. Returns `null` when the file has no audio track. Browser-only
 * (WebCodecs decode via Mediabunny).
 */
export async function extractAudioPeaks(
  src: MediaSourceLike,
  options: AudioPeaksOptions = {},
): Promise<AudioPeaks | null> {
  const bucketCount = options.buckets ?? 256
  const input = inputFor(src)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const durationMs = options.endMs ?? (await input.computeDuration()) * 1000
    const startMs = options.startMs ?? 0
    const spanMs = Math.max(1, durationMs - startMs)

    const peaks = new Float32Array(bucketCount)
    const sink = new AudioBufferSink(track)
    for await (const { buffer, timestamp } of sink.buffers(startMs / 1000, durationMs / 1000)) {
      const channel = buffer.getChannelData(0)
      const bufferStartMs = timestamp * 1000
      const msPerSample = 1000 / buffer.sampleRate
      // Stride so long files stay cheap; peaks are visual, not analytic.
      const stride = Math.max(1, Math.floor(channel.length / 4096))
      for (let i = 0; i < channel.length; i += stride) {
        const timeMs = bufferStartMs + i * msPerSample
        const bucket = Math.floor(((timeMs - startMs) / spanMs) * bucketCount)
        if (bucket < 0 || bucket >= bucketCount) continue
        const value = Math.abs(channel[i]!)
        if (value > peaks[bucket]!) peaks[bucket] = value
      }
    }
    return { peaks, durationMs: spanMs }
  } finally {
    input.dispose()
  }
}
