import { AudioBufferSink } from 'mediabunny'
import { bucketPeaks } from './audio-peaks'
import { inputFor, type MediaSourceLike } from './probe'

export const DEFAULT_ACTIVITY_FRAME_MS = 30
export const DEFAULT_ACTIVITY_THRESHOLD = 0.004
export const DEFAULT_MIN_SOUND_MS = 120
export const DEFAULT_MIN_SILENCE_MS = 120

export interface AudioActivityOptions {
  /** Source range. Defaults to the whole file for decoded media, or all samples for PCM input. */
  startMs?: number
  endMs?: number
  /** Fixed analysis frame size. Default 30ms. */
  frameMs?: number
  /** A frame is sound when RMS is greater than this threshold. Default 0.004. */
  threshold?: number
  /** Active runs shorter than this are treated as silence. Default 120ms. */
  minSoundMs?: number
  /** Silent runs shorter than this are treated as sound. Default 120ms. */
  minSilenceMs?: number
  /** Trim this much from each returned silence window edge. Default 0ms. */
  paddingMs?: number
  /** Optional compact max-amplitude waveform bucket count. */
  waveformBuckets?: number
}

export interface AudioActivityWindow {
  startMs: number
  endMs: number
  durationMs: number
  rms: number
  peakRms: number
  peakAmplitude: number
}

export interface AudioActivitySummary {
  soundMs: number
  silenceMs: number
  soundFraction: number
  silenceFraction: number
  peakRms: number
  peakAmplitude: number
}

export interface AudioActivity {
  durationMs: number
  soundWindows: AudioActivityWindow[]
  silenceWindows: AudioActivityWindow[]
  summary: AudioActivitySummary
  /** Max |sample| buckets, 0-1, only present when requested. */
  waveform?: number[]
}

interface FrameStats {
  startSample: number
  endSample: number
  startMs: number
  endMs: number
  active: boolean
  sumSquares: number
  sampleCount: number
  rms: number
  peakAmplitude: number
}

interface Run {
  startFrame: number
  endFrame: number
  active: boolean
}

interface NormalizedOptions {
  startMs: number
  endMs?: number
  frameMs: number
  threshold: number
  minSoundMs: number
  minSilenceMs: number
  paddingMs: number
  waveformBuckets?: number
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeOptions(options: AudioActivityOptions = {}): NormalizedOptions {
  const waveformBuckets =
    typeof options.waveformBuckets === 'number' &&
    Number.isFinite(options.waveformBuckets) &&
    options.waveformBuckets > 0
      ? Math.floor(options.waveformBuckets)
      : undefined
  return {
    startMs: finiteNonNegative(options.startMs, 0),
    ...(typeof options.endMs === 'number' && Number.isFinite(options.endMs) && options.endMs >= 0
      ? { endMs: options.endMs }
      : {}),
    frameMs: finitePositive(options.frameMs, DEFAULT_ACTIVITY_FRAME_MS),
    threshold: finiteNonNegative(options.threshold, DEFAULT_ACTIVITY_THRESHOLD),
    minSoundMs: finiteNonNegative(options.minSoundMs, DEFAULT_MIN_SOUND_MS),
    minSilenceMs: finiteNonNegative(options.minSilenceMs, DEFAULT_MIN_SILENCE_MS),
    paddingMs: finiteNonNegative(options.paddingMs, 0),
    ...(waveformBuckets !== undefined ? { waveformBuckets } : {}),
  }
}

function roundMs(value: number): number {
  return Math.round(value)
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function sliceSamples(samples: Float32Array, sampleRate: number, options: NormalizedOptions) {
  const sampleStart = Math.min(samples.length, Math.floor((options.startMs / 1000) * sampleRate))
  const sampleEnd =
    options.endMs === undefined
      ? samples.length
      : Math.min(samples.length, Math.max(sampleStart, Math.ceil((options.endMs / 1000) * sampleRate)))
  return samples.subarray(sampleStart, sampleEnd)
}

function frameSamples(samples: Float32Array, sampleRate: number, options: NormalizedOptions): FrameStats[] {
  const samplesPerFrame = Math.max(1, Math.round((options.frameMs / 1000) * sampleRate))
  const frames: FrameStats[] = []
  for (let startSample = 0; startSample < samples.length; startSample += samplesPerFrame) {
    const endSample = Math.min(samples.length, startSample + samplesPerFrame)
    let sumSquares = 0
    let peakAmplitude = 0
    for (let i = startSample; i < endSample; i++) {
      const value = samples[i] ?? 0
      const absolute = Math.abs(value)
      sumSquares += value * value
      if (absolute > peakAmplitude) peakAmplitude = absolute
    }
    const sampleCount = Math.max(1, endSample - startSample)
    const rms = Math.sqrt(sumSquares / sampleCount)
    frames.push({
      startSample,
      endSample,
      startMs: (startSample / sampleRate) * 1000,
      endMs: (endSample / sampleRate) * 1000,
      active: rms > options.threshold,
      sumSquares,
      sampleCount,
      rms,
      peakAmplitude,
    })
  }
  return frames
}

function frameRuns(frames: readonly FrameStats[]): Run[] {
  if (frames.length === 0) return []
  const runs: Run[] = []
  let startFrame = 0
  let active = frames[0]!.active
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.active === active) continue
    runs.push({ startFrame, endFrame: i, active })
    startFrame = i
    active = frames[i]!.active
  }
  runs.push({ startFrame, endFrame: frames.length, active })
  return runs
}

function runDurationMs(run: Run, frames: readonly FrameStats[]): number {
  const first = frames[run.startFrame]
  const last = frames[run.endFrame - 1]
  if (!first || !last) return 0
  return last.endMs - first.startMs
}

function smoothRuns(frames: FrameStats[], options: NormalizedOptions): void {
  for (const run of frameRuns(frames)) {
    if (!run.active || runDurationMs(run, frames) >= options.minSoundMs) continue
    for (let i = run.startFrame; i < run.endFrame; i++) frames[i]!.active = false
  }
  for (const run of frameRuns(frames)) {
    if (run.active || runDurationMs(run, frames) >= options.minSilenceMs) continue
    for (let i = run.startFrame; i < run.endFrame; i++) frames[i]!.active = true
  }
}

function windowFromRun(
  run: Run,
  frames: readonly FrameStats[],
  samples: Float32Array,
  sampleRate: number,
  paddingMs: number,
): AudioActivityWindow | null {
  const first = frames[run.startFrame]
  const last = frames[run.endFrame - 1]
  if (!first || !last) return null

  const startMs = first.startMs + (run.active ? 0 : paddingMs)
  const endMs = last.endMs - (run.active ? 0 : paddingMs)
  if (endMs <= startMs) return null

  const startSample = Math.min(samples.length, Math.floor((startMs / 1000) * sampleRate))
  const endSample = Math.min(samples.length, Math.max(startSample, Math.ceil((endMs / 1000) * sampleRate)))
  let sumSquares = 0
  let peakAmplitude = 0
  for (let i = startSample; i < endSample; i++) {
    const value = samples[i] ?? 0
    const absolute = Math.abs(value)
    sumSquares += value * value
    if (absolute > peakAmplitude) peakAmplitude = absolute
  }

  let peakRms = 0
  for (let i = run.startFrame; i < run.endFrame; i++) peakRms = Math.max(peakRms, frames[i]!.rms)

  const sampleCount = Math.max(1, endSample - startSample)
  return {
    startMs: roundMs(startMs),
    endMs: roundMs(endMs),
    durationMs: roundMs(endMs - startMs),
    rms: roundMetric(Math.sqrt(sumSquares / sampleCount)),
    peakRms: roundMetric(peakRms),
    peakAmplitude: roundMetric(peakAmplitude),
  }
}

function summarizeWindows(
  durationMs: number,
  soundWindows: readonly AudioActivityWindow[],
  samples: Float32Array,
  frames: readonly FrameStats[],
): AudioActivitySummary {
  const soundMs = soundWindows.reduce((total, window) => total + window.durationMs, 0)
  const silenceMs = Math.max(0, roundMs(durationMs - soundMs))
  let sumSquares = 0
  let peakAmplitude = 0
  for (const sample of samples) {
    const absolute = Math.abs(sample)
    sumSquares += sample * sample
    if (absolute > peakAmplitude) peakAmplitude = absolute
  }
  const peakRms = frames.reduce((peak, frame) => Math.max(peak, frame.rms), 0)
  return {
    soundMs,
    silenceMs,
    soundFraction: durationMs > 0 ? roundMetric(soundMs / durationMs) : 0,
    silenceFraction: durationMs > 0 ? roundMetric(silenceMs / durationMs) : 0,
    peakRms: roundMetric(peakRms),
    peakAmplitude: roundMetric(peakAmplitude),
  }
}

/** Analyze mono PCM samples into compact sound/silence windows. */
export function analyzeAudioSamples(
  samples: Float32Array,
  sampleRate: number,
  options: AudioActivityOptions = {},
): AudioActivity {
  const normalized = normalizeOptions(options)
  const sourceSamples = sliceSamples(samples, sampleRate, normalized)
  const durationMs = roundMs((sourceSamples.length / sampleRate) * 1000)
  const frames = frameSamples(sourceSamples, sampleRate, normalized)
  smoothRuns(frames, normalized)

  const soundWindows: AudioActivityWindow[] = []
  const silenceWindows: AudioActivityWindow[] = []
  for (const run of frameRuns(frames)) {
    const window = windowFromRun(run, frames, sourceSamples, sampleRate, normalized.paddingMs)
    if (!window) continue
    if (run.active) soundWindows.push(window)
    else silenceWindows.push(window)
  }

  const activity: AudioActivity = {
    durationMs,
    soundWindows,
    silenceWindows,
    summary: summarizeWindows(durationMs, soundWindows, sourceSamples, frames),
  }

  if (normalized.waveformBuckets !== undefined) {
    activity.waveform = [...bucketPeaks(sourceSamples, normalized.waveformBuckets)].map(roundMetric)
  }

  return activity
}

/**
 * Decode a media source's primary audio track and reduce it to semantic
 * sound/silence windows. Returns `null` when the file has no audio track.
 * Browser-only (WebCodecs decode via Mediabunny).
 */
export async function analyzeAudioActivity(
  src: MediaSourceLike,
  options: AudioActivityOptions = {},
): Promise<AudioActivity | null> {
  const normalized = normalizeOptions(options)
  const input = inputFor(src)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null

    const sourceEndMs = normalized.endMs ?? (await input.computeDuration()) * 1000
    const sourceStartMs = Math.min(normalized.startMs, sourceEndMs)
    const spanMs = Math.max(1, sourceEndMs - sourceStartMs)
    const samples: number[] = []
    let sampleRate = 48_000

    const sink = new AudioBufferSink(track)
    for await (const { buffer, timestamp } of sink.buffers(sourceStartMs / 1000, sourceEndMs / 1000)) {
      sampleRate = buffer.sampleRate
      const channels = Math.max(1, buffer.numberOfChannels)
      const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index))
      const bufferStartMs = timestamp * 1000
      const msPerSample = 1000 / sampleRate
      for (let i = 0; i < buffer.length; i++) {
        const timeMs = bufferStartMs + i * msPerSample
        if (timeMs < sourceStartMs || timeMs >= sourceEndMs) continue
        let channelSquares = 0
        for (const channel of channelData) {
          const value = channel[i] ?? 0
          channelSquares += value * value
        }
        samples.push(Math.sqrt(channelSquares / channels))
      }
    }

    const expectedSamples = Math.max(1, Math.ceil((spanMs / 1000) * sampleRate))
    const pcm = new Float32Array(expectedSamples)
    if (samples.length > 0) pcm.set(Float32Array.from(samples).subarray(0, expectedSamples))
    return {
      ...analyzeAudioSamples(pcm, sampleRate, {
        frameMs: normalized.frameMs,
        threshold: normalized.threshold,
        minSoundMs: normalized.minSoundMs,
        minSilenceMs: normalized.minSilenceMs,
        paddingMs: normalized.paddingMs,
        ...(normalized.waveformBuckets !== undefined ? { waveformBuckets: normalized.waveformBuckets } : {}),
      }),
      durationMs: roundMs(spanMs),
    }
  } finally {
    input.dispose()
  }
}
