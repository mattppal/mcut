import type { Project } from '@mcut/timeline'
import type { VideoSample, VideoSampleSink } from 'mediabunny'
import {
  changedFraction,
  lumaSignature,
  segmentsBetween,
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  thresholdFor,
  type PictureChange,
  type PictureSegment,
} from './picture-diff'
import { resolvePictureTarget, type PictureTarget, type PictureTargetInput } from './picture-target'
import { inputFor } from './probe'
import { sampleBitmap } from './sample-bitmap'

export interface SceneChangeOptions extends PictureTargetInput {
  stepMs?: number
  sensitivity?: number
  maxChanges?: number
}

export interface SceneChangeReport {
  elementId: string
  source?: string
  assetId: string
  startMs: number
  endMs: number
  stepMs: number
  sensitivity: number
  threshold: number
  sampled: number
  changes: PictureChange[]
  segments: PictureSegment[]
  truncated: boolean
}

class PictureSigner {
  private scratch: ImageData | null = null
  private readonly ctx: OffscreenCanvasRenderingContext2D

  constructor() {
    const ctx = new OffscreenCanvas(SIGNATURE_WIDTH, SIGNATURE_HEIGHT).getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Could not create a canvas context to compare frames.')
    this.ctx = ctx
  }

  async sign(sample: VideoSample): Promise<Uint8Array> {
    const { width, height } = sample.visibleRect
    if (this.scratch?.width !== width || this.scratch.height !== height) this.scratch = new ImageData(width, height)
    const bitmap = await sampleBitmap(sample, this.scratch, { width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT })
    try {
      this.ctx.drawImage(bitmap, 0, 0)
    } finally {
      bitmap.close()
    }
    return lumaSignature(this.ctx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data)
  }
}

function sampleTimes(startMs: number, endMs: number, stepMs: number): number[] {
  const times: number[] = []
  for (let t = startMs; t < endMs; t += stepMs) times.push(t)
  const last = endMs - 1
  if ((times.at(-1) ?? startMs) < last) times.push(last)
  return times
}

async function coarseSignatures(sink: VideoSampleSink, signer: PictureSigner, target: PictureTarget, times: readonly number[]) {
  const order = times.map((timeMs, index) => ({ index, sourceMs: target.sourceMsAt(timeMs) })).sort((a, b) => a.sourceMs - b.sourceMs)
  const signatures: (Uint8Array | null)[] = times.map(() => null)
  let next = 0
  for await (const sample of sink.samplesAtTimestamps(order.map((o) => o.sourceMs / 1000))) {
    const slot = order[next++]
    if (!sample) continue
    try {
      if (slot) signatures[slot.index] = await signer.sign(sample)
    } finally {
      sample.close()
    }
  }
  return signatures
}

async function refineChange(sink: VideoSampleSink, signer: PictureSigner, target: PictureTarget, fromMs: number, toMs: number): Promise<PictureChange> {
  const fromSource = target.sourceMsAt(fromMs)
  const toSource = target.sourceMsAt(toMs)
  const lo = Math.min(fromSource, toSource)
  const hi = Math.max(fromSource, toSource)
  let previous: Uint8Array | null = null
  let best = { changed: -1, sourceMs: toSource }
  for await (const sample of sink.samples(lo / 1000, hi / 1000 + 0.0005)) {
    try {
      const signature = await signer.sign(sample)
      if (previous) {
        const changed = changedFraction(previous, signature)
        if (changed > best.changed) best = { changed, sourceMs: sample.timestamp * 1000 }
      }
      previous = signature
    } finally {
      sample.close()
    }
  }
  const ratio = toSource === fromSource ? 1 : (best.sourceMs - fromSource) / (toSource - fromSource)
  const timeMs = fromMs + Math.min(1, Math.max(0, ratio)) * (toMs - fromMs)
  return { timeMs: Math.round(timeMs), changed: Math.round(Math.max(0, best.changed) * 1000) / 1000 }
}

export async function findSceneChanges(project: Project, options: SceneChangeOptions = {}): Promise<SceneChangeReport> {
  const target = resolvePictureTarget(project, options)
  const stepMs = options.stepMs ?? 500
  const sensitivity = options.sensitivity ?? 0.5
  const maxChanges = options.maxChanges ?? 40
  const threshold = thresholdFor(sensitivity)
  const times = sampleTimes(target.startMs, target.endMs, stepMs)
  const input = await inputFor(target.asset.src)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(`Asset "${target.asset.id}" has no video track.`)
    const { VideoSampleSink } = await import('mediabunny')
    const sink = new VideoSampleSink(track)
    const signer = new PictureSigner()
    const signatures = await coarseSignatures(sink, signer, target, times)
    const flagged: { index: number; changed: number }[] = []
    for (let i = 1; i < times.length; i++) {
      const before = signatures[i - 1]
      const after = signatures[i]
      if (!before || !after) continue
      const changed = changedFraction(before, after)
      if (changed >= threshold) flagged.push({ index: i, changed })
    }
    const kept = [...flagged]
      .sort((a, b) => b.changed - a.changed)
      .slice(0, maxChanges)
      .sort((a, b) => a.index - b.index)
    const changes: PictureChange[] = []
    for (const { index } of kept) {
      changes.push(await refineChange(sink, signer, target, times[index - 1] ?? target.startMs, times[index] ?? target.endMs))
    }
    return {
      elementId: target.elementId,
      ...(target.source !== undefined ? { source: target.source } : {}),
      assetId: target.asset.id,
      startMs: target.startMs,
      endMs: target.endMs,
      stepMs,
      sensitivity,
      threshold: Math.round(threshold * 1000) / 1000,
      sampled: times.length,
      changes,
      segments: segmentsBetween(target.startMs, target.endMs, changes),
      truncated: flagged.length > kept.length,
    }
  } finally {
    input.dispose()
  }
}
