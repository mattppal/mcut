import {
  getElementLocation,
  getMulticamSourceTimeMs,
  getSourceTimeMs,
  type AssetRef,
  type ElementId,
  type MulticamElement,
  type Project,
  type TimelineElement,
  type VideoElement,
} from '@mcut/timeline'

export interface PictureTargetInput {
  elementId?: ElementId
  source?: string
  startMs?: number
  endMs?: number
}

export interface PictureTarget {
  elementId: ElementId
  source?: string
  asset: AssetRef
  startMs: number
  endMs: number
  sourceMsAt(timelineMs: number): number
}

type PictureElement = VideoElement | MulticamElement

const isPictureElement = (element: TimelineElement): element is PictureElement => element.type === 'video' || element.type === 'multicam'

function pickElement(project: Project, elementId: ElementId | undefined): PictureElement {
  if (elementId === undefined) {
    const elements = project.tracks.flatMap((track) => track.elements).filter(isPictureElement)
    const element = elements.find((e) => e.type === 'multicam') ?? elements[0]
    if (!element) throw new Error('The project has no video or multicam clip.')
    return element
  }
  const element = getElementLocation(project, elementId)?.element
  if (!element) throw new Error(`No element "${elementId}" in the project.`)
  if (!isPictureElement(element)) throw new Error(`"${elementId}" is ${element.type}. Pass a video or multicam clip.`)
  return element
}

function videoAsset(project: Project, assetId: string): AssetRef {
  const asset = project.assets[assetId]
  if (asset?.kind !== 'video') throw new Error(`Asset "${assetId}" is not a video.`)
  return asset
}

function span(element: PictureElement, input: PictureTargetInput): { startMs: number; endMs: number } {
  const clipEnd = element.startMs + element.durationMs
  const startMs = Math.max(element.startMs, input.startMs ?? element.startMs)
  const endMs = Math.min(clipEnd, input.endMs ?? clipEnd)
  if (endMs <= startMs) {
    throw new Error(`The range ${startMs} to ${endMs} ms is outside "${element.id}", which spans ${element.startMs} to ${clipEnd} ms on the timeline.`)
  }
  return { startMs, endMs }
}

export function resolvePictureTarget(project: Project, input: PictureTargetInput): PictureTarget {
  const element = pickElement(project, input.elementId)
  const range = span(element, input)
  if (element.type === 'video') {
    if (input.source !== undefined) throw new Error(`source picks a multicam angle, and "${element.id}" is a video clip.`)
    return {
      elementId: element.id,
      asset: videoAsset(project, element.assetId),
      ...range,
      sourceMsAt: (timelineMs) => Math.max(0, getSourceTimeMs(element, timelineMs - element.startMs)),
    }
  }
  const videoSources = element.sources.filter((s) => project.assets[s.assetId]?.kind === 'video')
  const source =
    input.source === undefined ? (videoSources.find((s) => s.key === 'screen') ?? videoSources[0]) : element.sources.find((s) => s.key === input.source)
  if (!source) {
    const keys = element.sources.map((s) => s.key).join(', ')
    throw new Error(`Multicam "${element.id}" has no ${input.source === undefined ? 'video source' : `source "${input.source}"`}, only ${keys}.`)
  }
  return {
    elementId: element.id,
    source: source.key,
    asset: videoAsset(project, source.assetId),
    ...range,
    sourceMsAt: (timelineMs) => getMulticamSourceTimeMs(element, source, timelineMs),
  }
}
