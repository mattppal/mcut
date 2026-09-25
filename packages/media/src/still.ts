import type { FrameSource } from '@mcut/compositor'
import type { Input, VideoSample, VideoSampleSink } from 'mediabunny'
import {
  assertNever,
  frameToMs,
  getElementLocation,
  getFrameRequests,
  getProjectDurationMs,
  getRenderableElements,
  isElementActiveAt,
  msToFrame,
  type AssetId,
  type ElementId,
  type Project,
  type TimelineElement,
} from '@mcut/timeline'
import { inputFor } from './probe'

export interface RenderProjectStillOptions {
  soloElementId?: ElementId
  width?: number
}

export interface ProjectStill {
  blob: Blob
  width: number
  height: number
  visibleElementIds: ElementId[]
}

const frameKey = (assetId: string, sourceTimeMs: number): string => `${assetId}@${Math.round(sourceTimeMs * 1000)}`

function secondsText(ms: number): string {
  return String(Math.round(ms) / 1000)
}

function lastFrameMs(project: Project, durationMs: number): number {
  return frameToMs(Math.max(0, msToFrame(durationMs, project.fps) - 1), project.fps)
}

function isAssetId(value: string): value is AssetId {
  return value.startsWith('a-')
}

function assetIdOf(value: string): AssetId {
  if (isAssetId(value)) return value
  throw new Error(`Asset ${value} is not a valid asset id.`)
}

type PictureKind = 'frame' | 'drawn' | 'silent'

function pictureKind(element: TimelineElement): PictureKind {
  switch (element.type) {
    case 'video':
    case 'image':
    case 'multicam':
      return 'frame'
    case 'text':
    case 'caption':
      return 'drawn'
    case 'audio':
      return 'silent'
    default:
      return assertNever(element)
  }
}

function visibleElements(project: Project, timeMs: number): TimelineElement[] {
  const seen = new Set<string>()
  const elements: TimelineElement[] = []
  for (const item of getRenderableElements(project, timeMs)) {
    if (item.track.hidden || pictureKind(item.element) === 'silent' || seen.has(item.element.id)) continue
    seen.add(item.element.id)
    elements.push(item.element)
  }
  return elements
}

function requireSolo(project: Project, timeMs: number, elementId: ElementId, visible: readonly TimelineElement[]): TimelineElement {
  const location = getElementLocation(project, elementId)
  if (!location) throw new Error(`Element ${elementId} is not in the project.`)
  if (visible.some((element) => element.id === elementId)) return location.element
  if (location.track.hidden) {
    throw new Error(`Element ${elementId} is not on screen at ${secondsText(timeMs)} s. Its track is hidden.`)
  }
  if (pictureKind(location.element) === 'silent' && isElementActiveAt(location.element, timeMs)) {
    throw new Error(`Element ${elementId} is audio and has no picture.`)
  }
  const start = location.element.startMs
  const end = start + location.element.durationMs
  throw new Error(`Element ${elementId} is not on screen at ${secondsText(timeMs)} s. It spans ${secondsText(start)} to ${secondsText(end)} s.`)
}

async function sampleBitmap(sample: VideoSample): Promise<ImageBitmap> {
  const image = new ImageData(sample.visibleRect.width, sample.visibleRect.height)
  await sample.copyTo(image.data, { format: 'RGBA' })
  return createImageBitmap(image, { resizeWidth: sample.squarePixelWidth, resizeHeight: sample.squarePixelHeight })
}

function outputSize(projectWidth: number, projectHeight: number, maxWidth: number | undefined): { width: number; height: number; scale: number } {
  const scale = maxWidth === undefined || projectWidth <= maxWidth ? 1 : maxWidth / projectWidth
  return {
    width: Math.max(1, Math.round(projectWidth * scale)),
    height: Math.max(1, Math.round(projectHeight * scale)),
    scale,
  }
}

class StillFrameSource implements FrameSource {
  private readonly inputs = new Map<AssetId, { input: Input; sink: VideoSampleSink }>()
  private readonly images = new Map<AssetId, ImageBitmap>()
  private readonly bitmaps: ImageBitmap[] = []
  private readonly frames = new Map<string, CanvasImageSource>()

  constructor(private readonly project: Project) {}

  async prepare(elements: readonly TimelineElement[], timeMs: number): Promise<void> {
    for (const element of elements) await this.loadElement(element, timeMs)
  }

  getFrame(assetId: AssetId, sourceTimeMs: number): CanvasImageSource | null {
    return this.frames.get(frameKey(assetId, sourceTimeMs)) ?? null
  }

  dispose(): void {
    for (const bitmap of this.bitmaps) bitmap.close()
    this.bitmaps.length = 0
    for (const bitmap of this.images.values()) bitmap.close()
    this.images.clear()
    this.frames.clear()
    for (const entry of this.inputs.values()) entry.input.dispose()
    this.inputs.clear()
  }

  private async loadElement(element: TimelineElement, timeMs: number): Promise<void> {
    if (pictureKind(element) !== 'frame') return
    for (const request of getFrameRequests(this.project, element, timeMs)) {
      const assetId = assetIdOf(request.assetId)
      if (element.type === 'image') await this.ensureImage(assetId, request.sourceTimeMs)
      else await this.ensureVideoFrame(assetId, request.sourceTimeMs)
    }
  }

  private async ensureImage(assetId: AssetId, sourceTimeMs: number): Promise<void> {
    const key = frameKey(assetId, sourceTimeMs)
    if (this.frames.has(key)) return
    const asset = this.project.assets[assetId]
    if (!asset) throw new Error(`Asset ${assetId} is not in the project.`)
    const response = await fetch(asset.src)
    if (!response.ok) throw new Error(`Could not load image asset ${assetId} (${response.status}).`)
    const bitmap = await createImageBitmap(await response.blob())
    this.images.set(assetId, bitmap)
    this.frames.set(key, bitmap)
  }

  private async ensureSink(assetId: AssetId): Promise<VideoSampleSink> {
    const existing = this.inputs.get(assetId)
    if (existing) return existing.sink
    const asset = this.project.assets[assetId]
    if (!asset) throw new Error(`Asset ${assetId} is not in the project.`)
    const input = await inputFor(asset.src)
    let stored = false
    try {
      const track = await input.getPrimaryVideoTrack()
      if (!track) throw new Error(`Asset ${assetId} has no video track.`)
      const { VideoSampleSink } = await import('mediabunny')
      const sink = new VideoSampleSink(track)
      this.inputs.set(assetId, { input, sink })
      stored = true
      return sink
    } finally {
      if (!stored) input.dispose()
    }
  }

  private async ensureVideoFrame(assetId: AssetId, sourceTimeMs: number): Promise<void> {
    const key = frameKey(assetId, sourceTimeMs)
    if (this.frames.has(key)) return
    const sink = await this.ensureSink(assetId)
    const sample = await sink.getSample(Math.max(0, sourceTimeMs / 1000))
    if (!sample) return
    try {
      const bitmap = await sampleBitmap(sample)
      this.bitmaps.push(bitmap)
      this.frames.set(key, bitmap)
    } finally {
      sample.close()
    }
  }
}

export async function renderProjectStill(project: Project, timeMs: number, options: RenderProjectStillOptions = {}): Promise<ProjectStill> {
  if (!Number.isFinite(timeMs) || timeMs < 0) throw new Error('timeMs must be a non-negative number.')
  const durationMs = getProjectDurationMs(project)
  if (timeMs > durationMs) {
    throw new Error(`Cannot grab a frame at ${secondsText(timeMs)} s. The project ends at ${secondsText(durationMs)} s.`)
  }
  if (!(project.width > 0) || !(project.height > 0)) {
    throw new Error(`Project dimensions must be positive (${project.width} by ${project.height}).`)
  }
  const maxWidth = options.width
  if (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0)) throw new Error('width must be a positive number.')

  const frameMs = timeMs < durationMs ? timeMs : lastFrameMs(project, durationMs)
  const visible = visibleElements(project, frameMs)
  const shown = options.soloElementId ? [requireSolo(project, frameMs, options.soloElementId, visible)] : visible
  const size = outputSize(project.width, project.height, maxWidth)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create still canvas context.')

  const source = new StillFrameSource(project)
  try {
    await source.prepare(
      shown.filter((element) => pictureKind(element) === 'frame'),
      frameMs,
    )
    const { renderFrame } = await import('@mcut/compositor')
    ctx.setTransform(size.scale, 0, 0, size.scale, 0, 0)
    const skipElementIds = options.soloElementId
      ? new Set(getRenderableElements(project, frameMs).flatMap((item) => (item.element.id === options.soloElementId ? [] : [item.element.id])))
      : undefined
    renderFrame(ctx, project, frameMs, {
      source,
      ...(skipElementIds ? { skipElementIds } : {}),
    })
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return { blob, width: size.width, height: size.height, visibleElementIds: shown.map((element) => element.id) }
  } finally {
    source.dispose()
  }
}
