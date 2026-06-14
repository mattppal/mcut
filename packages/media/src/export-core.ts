import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Input,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  VideoSampleSink,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type Quality,
  type VideoSample,
} from 'mediabunny'
import { renderFrame, type FrameSource } from '@mcut/compositor'
import {
  getFrameRequests,
  getProjectDurationMs,
  getRenderableElements,
  type AssetId,
  type Project,
} from '@mcut/timeline'
import { getContainerFormat, type ContainerFormatEntry } from './container-formats'
import { ensureFallbackAudioEncoders } from './encoders'
import { inputFor } from './probe'
import {
  AUDIO_SAMPLE_RATE,
  type ContainerFormatId,
  type ExportProgress,
  type MixedAudioData,
} from './export-types'

/**
 * The decode→composite→encode→mux pipeline. Everything here is worker-safe:
 * no `OfflineAudioContext`, no `AudioBuffer`, no DOM — the audio mix arrives
 * pre-rendered as planar PCM and is encoded via `AudioSampleSource`.
 */

export function resolveContainerFormat(id: ContainerFormatId = 'mp4'): ContainerFormatEntry {
  const entry = getContainerFormat(id)
  if (!entry) {
    throw new Error(`unknown container format "${id}" (register it with registerContainerFormat)`)
  }
  return entry
}

/** Can this browser encode video (and audio) for the given format? */
export async function getExportSupport(format: ContainerFormatId = 'mp4'): Promise<{
  video: boolean
  audio: boolean
}> {
  if (typeof OffscreenCanvas === 'undefined' || typeof VideoEncoder === 'undefined') {
    return { video: false, audio: false }
  }
  await ensureFallbackAudioEncoders()
  const outputFormat = resolveContainerFormat(format).createOutputFormat()
  const [video, audio] = await Promise.all([
    getFirstEncodableVideoCodec(outputFormat.getSupportedVideoCodecs(), {
      width: 1920,
      height: 1080,
    }),
    getFirstEncodableAudioCodec(outputFormat.getSupportedAudioCodecs(), {
      numberOfChannels: 2,
      sampleRate: AUDIO_SAMPLE_RATE,
    }),
  ])
  return { video: video !== null, audio: audio !== null }
}

export interface ExportPipelineOptions {
  format?: ContainerFormatId
  videoBitrate?: number | Quality
  /** Pre-rendered audio mix; null exports a silent (video-only) file. */
  mixedAudio: MixedAudioData | null
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportPipelineResult {
  buffer: ArrayBuffer
  mimeType: string
  extension: string
}

/** ~1s encode chunks: bounded AudioData allocations, steady backpressure. */
const AUDIO_CHUNK_FRAMES = 48_000

/**
 * Slice planar stereo PCM into `[left|right]` chunks for `AudioSample`
 * (f32-planar layout = each channel contiguous within a chunk).
 */
export function* planarAudioChunks(
  mixed: MixedAudioData,
  chunkFrames = AUDIO_CHUNK_FRAMES,
): Generator<{ data: Float32Array; frames: number; timestamp: number }> {
  const total = Math.min(mixed.left.length, mixed.right.length)
  for (let start = 0; start < total; start += chunkFrames) {
    const frames = Math.min(chunkFrames, total - start)
    const data = new Float32Array(frames * 2)
    data.set(mixed.left.subarray(start, start + frames), 0)
    data.set(mixed.right.subarray(start, start + frames), frames)
    yield { data, frames, timestamp: start / mixed.sampleRate }
  }
}

/**
 * Render a project to a video file, fully client-side and deterministically:
 * exact decoded samples per output frame (no `<video>` seeking), WebCodecs
 * encoding, Mediabunny muxing. Runs in the export worker (or inline as the
 * main-thread fallback).
 */
export async function runExportPipeline(
  project: Project,
  options: ExportPipelineOptions,
): Promise<ExportPipelineResult> {
  const { onProgress, signal, mixedAudio } = options
  const durationMs = getProjectDurationMs(project)
  if (durationMs <= 0) throw new Error('Cannot export an empty project')
  await ensureFallbackAudioEncoders()
  const fps = project.fps
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps))

  const container = resolveContainerFormat(options.format)
  const format = container.createOutputFormat()
  const target = new BufferTarget()
  const output = new Output({ format, target })

  const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), {
    width: project.width,
    height: project.height,
  })
  if (!videoCodec) {
    throw new Error('This browser cannot encode video (WebCodecs unavailable or no supported codec)')
  }

  const canvas = new OffscreenCanvas(project.width, project.height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create export canvas context')

  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    bitrate: options.videoBitrate ?? QUALITY_HIGH,
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  let audioSource: AudioSampleSource | null = null
  if (mixedAudio) {
    const audioCodec = await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
      numberOfChannels: 2,
      sampleRate: mixedAudio.sampleRate,
    })
    if (audioCodec) {
      audioSource = new AudioSampleSource({ codec: audioCodec, bitrate: QUALITY_MEDIUM })
      output.addAudioTrack(audioSource)
    }
  }

  const frameSource = new ExportFrameSource(project)
  try {
    await output.start()
    if (audioSource && mixedAudio) {
      for (const chunk of planarAudioChunks(mixedAudio)) {
        signal?.throwIfAborted()
        const sample = new AudioSample({
          data: chunk.data,
          format: 'f32-planar',
          numberOfChannels: 2,
          sampleRate: mixedAudio.sampleRate,
          timestamp: chunk.timestamp,
        })
        await audioSource.add(sample)
        sample.close()
      }
      audioSource.close()
    }

    for (let frame = 0; frame < totalFrames; frame++) {
      signal?.throwIfAborted()
      // Sample each frame at its midpoint so boundaries land unambiguously.
      const midMs = ((frame + 0.5) * 1000) / fps
      await frameSource.prepare(midMs)
      // Extra motion-blur passes are cheap here (transform-only redraws).
      renderFrame(ctx, project, midMs, { source: frameSource, motionBlurSamples: 16 })
      await videoSource.add(frame / fps, 1 / fps)
      frameSource.releaseFrameTemporaries()
      onProgress?.({ phase: 'video', progress: 0.1 + 0.85 * ((frame + 1) / totalFrames) })
    }
    videoSource.close()

    onProgress?.({ phase: 'finalize', progress: 0.97 })
    await output.finalize()
  } catch (error) {
    await output.cancel().catch(() => {})
    throw error
  } finally {
    frameSource.dispose()
  }

  if (!target.buffer) throw new Error('Export produced no data')
  return {
    buffer: target.buffer,
    mimeType: format.mimeType,
    extension: container.extension,
  }
}

// ---------------------------------------------------------------------------

const frameKey = (assetId: string, sourceTimeMs: number): string =>
  `${assetId}@${Math.round(sourceTimeMs * 1000)}` // µs precision

interface ElementVideoState {
  iterator: AsyncGenerator<VideoSample, void, unknown>
  current: VideoSample | null
  pending: VideoSample | null
  done: boolean
  lastTargetS: number
}

/**
 * The exact {@link FrameSource} for export: per-element decoded sample
 * iterators (monotonic within an element), advanced frame-by-frame. The
 * async `prepare()` populates a per-frame cache that the synchronous
 * compositor then reads.
 */
export class ExportFrameSource implements FrameSource {
  private inputs = new Map<AssetId, { input: Input; sink: VideoSampleSink | null }>()
  private states = new Map<string, ElementVideoState>()
  private images = new Map<AssetId, ImageBitmap | null>()
  private frameCache = new Map<string, CanvasImageSource>()
  private temporaries: VideoFrame[] = []

  constructor(private project: Project) {}

  async prepare(timeMs: number): Promise<void> {
    this.frameCache.clear()
    // Transition-aware: partners render outside their own active ranges.
    for (const { track, element } of getRenderableElements(this.project, timeMs)) {
      if (track.hidden) continue
      if (element.type === 'image') {
        const bitmap = await this.ensureImage(element.assetId)
        if (bitmap) this.frameCache.set(frameKey(element.assetId, 0), bitmap)
      } else if (element.type === 'video' || element.type === 'multicam') {
        // getFrameRequests is the shared render/decode seam — keys here must
        // match the compositor's requests to the millisecond.
        for (const request of getFrameRequests(this.project, element, timeMs)) {
          const sample = await this.advance(
            `${element.id}:${request.assetId}`,
            request.assetId as AssetId,
            request.sourceTimeMs / 1000,
          )
          if (sample) {
            const image = sample.toCanvasImageSource()
            if (typeof VideoFrame !== 'undefined' && image instanceof VideoFrame) {
              this.temporaries.push(image)
            }
            this.frameCache.set(frameKey(request.assetId, request.sourceTimeMs), image)
          }
        }
      }
    }
  }

  getFrame(assetId: AssetId, sourceTimeMs: number): CanvasImageSource | null {
    return this.frameCache.get(frameKey(assetId, sourceTimeMs)) ?? null
  }

  /** Close per-frame `VideoFrame`s after the frame has been encoded. */
  releaseFrameTemporaries(): void {
    for (const frame of this.temporaries) frame.close()
    this.temporaries = []
  }

  dispose(): void {
    this.releaseFrameTemporaries()
    for (const state of this.states.values()) {
      state.current?.close()
      state.pending?.close()
      void state.iterator.return(undefined)
    }
    this.states.clear()
    for (const { input } of this.inputs.values()) input.dispose()
    this.inputs.clear()
    for (const bitmap of this.images.values()) bitmap?.close()
    this.images.clear()
  }

  private async ensureSink(assetId: AssetId): Promise<VideoSampleSink | null> {
    const existing = this.inputs.get(assetId)
    if (existing) return existing.sink
    const asset = this.project.assets[assetId]
    if (!asset) {
      return null
    }
    const input = inputFor(asset.src)
    const track = await input.getPrimaryVideoTrack()
    const sink = track ? new VideoSampleSink(track) : null
    this.inputs.set(assetId, { input, sink })
    return sink
  }

  private async ensureImage(assetId: AssetId): Promise<ImageBitmap | null> {
    if (this.images.has(assetId)) return this.images.get(assetId) ?? null
    const asset = this.project.assets[assetId]
    if (!asset) return null
    try {
      const response = await fetch(asset.src)
      const bitmap = await createImageBitmap(await response.blob())
      this.images.set(assetId, bitmap)
      return bitmap
    } catch {
      this.images.set(assetId, null)
      return null
    }
  }

  private async advance(stateKey: string, assetId: AssetId, targetS: number): Promise<VideoSample | null> {
    let state = this.states.get(stateKey)
    if (state && targetS < state.lastTargetS) {
      // Backward jump (shouldn't happen during a linear export): restart.
      state.current?.close()
      state.pending?.close()
      void state.iterator.return(undefined)
      state = undefined
      this.states.delete(stateKey)
    }
    if (!state) {
      const sink = await this.ensureSink(assetId)
      if (!sink) return null
      state = {
        iterator: sink.samples(Math.max(0, targetS)),
        current: null,
        pending: null,
        done: false,
        lastTargetS: targetS,
      }
      this.states.set(stateKey, state)
    }
    state.lastTargetS = targetS

    while (!state.done) {
      if (state.pending) {
        if (state.pending.timestamp <= targetS) {
          state.current?.close()
          state.current = state.pending
          state.pending = null
        } else {
          break
        }
      } else {
        const result = await state.iterator.next()
        if (result.done) {
          state.done = true
        } else {
          state.pending = result.value
        }
      }
    }
    return state.current
  }
}
