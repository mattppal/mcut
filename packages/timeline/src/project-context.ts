import {
  getAverageSpeed,
  getSourceSpanMs,
} from './speed'
import { getProjectDurationMs } from './selectors'
import type {
  AssetRef,
  AudioElement,
  CaptionElement,
  Marker,
  MulticamElement,
  Project,
  TimelineElement,
  Track,
  VideoElement,
} from './model'
import type { PlaybackState } from './engine'

export interface ProjectCaptionRef {
  trackId: string
  trackName: string
  trackIndex: number
  caption: CaptionElement
}

export interface ProjectTranscriptWordContext {
  text: string
  startMs: number
  endMs: number
}

export interface ProjectTranscriptCaptionContext {
  id: string
  trackId: string
  trackName: string
  startMs: number
  endMs: number
  durationMs: number
  text: string
  hasWordTimings: boolean
  wordCount: number
  words?: ProjectTranscriptWordContext[]
}

export interface ProjectTranscriptContext {
  hasTranscript: boolean
  captionCount: number
  wordCount: number
  text: string
  captions: ProjectTranscriptCaptionContext[]
}

export interface ProjectTranscriptOptions {
  includeWords?: boolean
}

export interface ProjectViewContextOptions {
  playback?: PlaybackState
  selection?: { elementIds: readonly string[] }
}

export interface ProjectMediaContext {
  project: {
    id: string
    name: string
    width: number
    height: number
    fps: number
    durationMs: number
    trackCount: number
    assetCount: number
    markerCount: number
  }
  playback?: PlaybackState
  selection: { elementIds: string[] }
  assets: ProjectMediaAssetContext[]
  tracks: ProjectMediaTrackContext[]
  markers: Marker[]
  transcript: {
    hasTranscript: boolean
    captionCount: number
    wordCount: number
    startMs?: number
    endMs?: number
  }
}

export interface ProjectMediaAssetContext
  extends Omit<AssetRef, 'src'> {
  usedBy: string[]
}

export interface ProjectMediaTrackContext {
  id: string
  name: string
  index: number
  muted: boolean
  hidden: boolean
  locked: boolean
  magnetic: boolean
  elements: ProjectMediaElementContext[]
}

export interface ProjectMediaElementContext {
  id: string
  type: TimelineElement['type']
  trackId: string
  trackName: string
  trackIndex: number
  startMs: number
  endMs: number
  durationMs: number
  selected: boolean
  active?: boolean
  linkId?: string
  asset?: {
    id: string
    kind?: AssetRef['kind']
    name?: string
    durationMs?: number
    width?: number
    height?: number
    mimeType?: string
    nativePreview?: boolean
  }
  source?: {
    startMs: number
    endMs: number
    durationMs: number
    averageSpeed: number
    hasTimeMap: boolean
    reversed: boolean
  }
  text?: string
  caption?: {
    hasWordTimings: boolean
    wordCount: number
  }
  multicam?: {
    audioSource?: string
    angleCount: number
    sources: Array<{
      key: string
      assetId: string
      assetName?: string
      trimStartMs: number
    }>
  }
  effects?: string[]
  blendMode?: string
  transition?: {
    type: string
    durationMs: number
  }
}

export function getProjectCaptions(project: Project): ProjectCaptionRef[] {
  return project.tracks
    .flatMap((track, trackIndex) =>
      track.elements
        .filter((element): element is CaptionElement => element.type === 'caption')
        .map((caption) => ({
          trackId: track.id,
          trackName: track.name,
          trackIndex,
          caption,
        })),
    )
    .sort(
      (a, b) =>
        a.caption.startMs - b.caption.startMs ||
        a.trackIndex - b.trackIndex ||
        a.caption.id.localeCompare(b.caption.id),
    )
}

export function getProjectTranscript(
  project: Project,
  options: ProjectTranscriptOptions = {},
): ProjectTranscriptContext {
  const captions = getProjectCaptions(project).map(({ trackId, trackName, caption }) => {
    const words = caption.words ?? []
    const context: ProjectTranscriptCaptionContext = {
      id: caption.id,
      trackId,
      trackName,
      startMs: caption.startMs,
      endMs: caption.startMs + caption.durationMs,
      durationMs: caption.durationMs,
      text: caption.text,
      hasWordTimings: words.length > 0,
      wordCount: words.length,
    }
    if (options.includeWords) {
      context.words = words.map((word) => ({
        text: word.text,
        startMs: caption.startMs + word.startMs,
        endMs: caption.startMs + word.endMs,
      }))
    }
    return context
  })
  const wordCount = captions.reduce((sum, caption) => sum + caption.wordCount, 0)
  return {
    hasTranscript: captions.length > 0,
    captionCount: captions.length,
    wordCount,
    text: captions.map((caption) => caption.text).join('\n'),
    captions,
  }
}

export function getProjectMediaContext(
  project: Project,
  options: ProjectViewContextOptions = {},
): ProjectMediaContext {
  const selected = new Set(options.selection?.elementIds ?? [])
  const usedBy = collectAssetUsage(project)
  const transcript = getProjectTranscript(project)
  const transcriptStart = transcript.captions[0]?.startMs
  const transcriptEnd = transcript.captions.at(-1)?.endMs

  return {
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      fps: project.fps,
      durationMs: getProjectDurationMs(project),
      trackCount: project.tracks.length,
      assetCount: Object.keys(project.assets).length,
      markerCount: project.markers.length,
    },
    ...(options.playback ? { playback: options.playback } : {}),
    selection: { elementIds: [...selected] },
    assets: Object.values(project.assets)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ src: _src, ...asset }) => ({
        ...asset,
        usedBy: [...(usedBy.get(asset.id) ?? [])].sort(),
      })),
    tracks: project.tracks.map((track, trackIndex) => ({
      id: track.id,
      name: track.name,
      index: trackIndex,
      muted: track.muted,
      hidden: track.hidden,
      locked: track.locked,
      magnetic: track.magnetic,
      elements: track.elements.map((element) =>
        elementContext(project, track, trackIndex, element, selected, options.playback),
      ),
    })),
    markers: project.markers,
    transcript: {
      hasTranscript: transcript.hasTranscript,
      captionCount: transcript.captionCount,
      wordCount: transcript.wordCount,
      ...(transcriptStart !== undefined ? { startMs: transcriptStart } : {}),
      ...(transcriptEnd !== undefined ? { endMs: transcriptEnd } : {}),
    },
  }
}

function collectAssetUsage(project: Project): Map<string, Set<string>> {
  const usedBy = new Map<string, Set<string>>()
  const add = (assetId: string, elementId: string) => {
    let elements = usedBy.get(assetId)
    if (!elements) {
      elements = new Set()
      usedBy.set(assetId, elements)
    }
    elements.add(elementId)
  }
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if ('assetId' in element) add(element.assetId, element.id)
      if (element.type === 'multicam') {
        for (const source of element.sources) add(source.assetId, element.id)
      }
    }
  }
  return usedBy
}

function elementContext(
  project: Project,
  track: Track,
  trackIndex: number,
  element: TimelineElement,
  selected: Set<string>,
  playback: PlaybackState | undefined,
): ProjectMediaElementContext {
  const base: ProjectMediaElementContext = {
    id: element.id,
    type: element.type,
    trackId: track.id,
    trackName: track.name,
    trackIndex,
    startMs: element.startMs,
    endMs: element.startMs + element.durationMs,
    durationMs: element.durationMs,
    selected: selected.has(element.id),
    ...(playback
      ? {
          active:
            playback.currentTimeMs >= element.startMs &&
            playback.currentTimeMs < element.startMs + element.durationMs,
        }
      : {}),
    ...(element.linkId ? { linkId: element.linkId } : {}),
  }

  if ('effects' in element && element.effects && element.effects.length > 0) {
    base.effects = element.effects.map((effect) => effect.type)
  }
  if ('blendMode' in element && element.blendMode) {
    base.blendMode = element.blendMode
  }
  if ('transition' in element && element.transition) {
    base.transition = {
      type: element.transition.type,
      durationMs: element.transition.durationMs,
    }
  }

  if (element.type === 'video' || element.type === 'audio') {
    addAssetContext(base, project, element.assetId)
    addSourceContext(base, element)
    return base
  }
  if (element.type === 'image') {
    addAssetContext(base, project, element.assetId)
    return base
  }
  if (element.type === 'text') {
    base.text = element.text
    return base
  }
  if (element.type === 'caption') {
    base.text = element.text
    base.caption = {
      hasWordTimings: (element.words?.length ?? 0) > 0,
      wordCount: element.words?.length ?? 0,
    }
    return base
  }
  if (element.type === 'multicam') {
    addMulticamContext(base, project, element)
  }
  return base
}

function addAssetContext(
  target: ProjectMediaElementContext,
  project: Project,
  assetId: string,
): void {
  const asset = project.assets[assetId]
  if (!asset) {
    target.asset = { id: assetId }
    return
  }
  target.asset = {
    id: asset.id,
    kind: asset.kind,
    ...(asset.name ? { name: asset.name } : {}),
    ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
    ...(asset.width !== undefined ? { width: asset.width } : {}),
    ...(asset.height !== undefined ? { height: asset.height } : {}),
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.nativePreview !== undefined ? { nativePreview: asset.nativePreview } : {}),
  }
}

function addSourceContext(
  target: ProjectMediaElementContext,
  element: VideoElement | AudioElement,
): void {
  const sourceStartMs = element.trimStartMs
  const sourceDurationMs = getSourceSpanMs(element)
  target.source = {
    startMs: sourceStartMs,
    endMs: sourceStartMs + sourceDurationMs,
    durationMs: sourceDurationMs,
    averageSpeed: getAverageSpeed(element),
    hasTimeMap: !!element.timeMap,
    reversed: !!element.reversed,
  }
}

function addMulticamContext(
  target: ProjectMediaElementContext,
  project: Project,
  element: MulticamElement,
): void {
  const sourceDurationMs = getSourceSpanMs(element)
  target.source = {
    startMs: 0,
    endMs: sourceDurationMs,
    durationMs: sourceDurationMs,
    averageSpeed: getAverageSpeed(element),
    hasTimeMap: !!element.timeMap,
    reversed: false,
  }
  target.multicam = {
    ...(element.audioSource ? { audioSource: element.audioSource } : {}),
    angleCount: element.angles.length,
    sources: element.sources.map((source) => ({
      key: source.key,
      assetId: source.assetId,
      ...(project.assets[source.assetId]?.name
        ? { assetName: project.assets[source.assetId]!.name }
        : {}),
      trimStartMs: source.trimStartMs,
    })),
  }
}
