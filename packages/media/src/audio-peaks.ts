import { inputFor, type MediaSourceLike } from './probe'
import { valueAt } from './value-at'

export interface AudioPeaksOptions {
  buckets?: number
  startMs?: number
  endMs?: number
}

export interface AudioPeaks {
  peaks: Float32Array
  durationMs: number
}

export function bucketPeaks(samples: Float32Array, buckets: number): Float32Array {
  const peaks = new Float32Array(Math.max(1, buckets))
  if (samples.length === 0) return peaks
  const perBucket = samples.length / peaks.length
  for (let i = 0; i < samples.length; i++) {
    const bucket = Math.min(peaks.length - 1, Math.floor(i / perBucket))
    const value = Math.abs(valueAt(samples, i))
    if (value > valueAt(peaks, bucket)) peaks[bucket] = value
  }
  return peaks
}

export async function extractAudioPeaks(src: MediaSourceLike, options: AudioPeaksOptions = {}): Promise<AudioPeaks | null> {
  const bucketCount = options.buckets ?? 256
  const input = await inputFor(src)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    const { AudioBufferSink } = await import('mediabunny')
    const durationMs = options.endMs ?? (await input.computeDuration()) * 1000
    const startMs = options.startMs ?? 0
    const spanMs = Math.max(1, durationMs - startMs)

    const peaks = new Float32Array(bucketCount)
    const sink = new AudioBufferSink(track)
    for await (const { buffer, timestamp } of sink.buffers(startMs / 1000, durationMs / 1000)) {
      const channel = buffer.getChannelData(0)
      const bufferStartMs = timestamp * 1000
      const msPerSample = 1000 / buffer.sampleRate
      const stride = Math.max(1, Math.floor(channel.length / 4096))
      for (let i = 0; i < channel.length; i += stride) {
        const timeMs = bufferStartMs + i * msPerSample
        const bucket = Math.floor(((timeMs - startMs) / spanMs) * bucketCount)
        if (bucket < 0 || bucket >= bucketCount) continue
        const value = Math.abs(valueAt(channel, i))
        if (value > valueAt(peaks, bucket)) peaks[bucket] = value
      }
    }
    return { peaks, durationMs: spanMs }
  } finally {
    input.dispose()
  }
}
