import { assertNever } from './errors'
import type { AssetId } from './id'
import type { AudioElement, MulticamElement, Project, TimelineElement, VideoElement } from './model'

export type MediaClip = VideoElement | AudioElement | MulticamElement

export function isMediaClip(element: TimelineElement): element is MediaClip {
  return element.type === 'video' || element.type === 'audio' || element.type === 'multicam'
}

export function getMediaSourceDurationMs(project: Project, clip: MediaClip): number | undefined {
  switch (clip.type) {
    case 'video':
    case 'audio':
      return project.assets[clip.assetId]?.durationMs
    case 'multicam': {
      const coverage = clip.sources.flatMap((source) => {
        const durationMs = project.assets[source.assetId]?.durationMs
        return durationMs === undefined ? [] : [durationMs - source.offsetMs]
      })
      return coverage.length > 0 ? Math.min(...coverage) : undefined
    }
    default:
      return assertNever(clip)
  }
}

export function getElementAssetIds(element: TimelineElement): AssetId[] {
  switch (element.type) {
    case 'video':
    case 'audio':
    case 'image':
      return [element.assetId]
    case 'multicam':
      return element.sources.map((source) => source.assetId)
    case 'text':
    case 'caption':
      return []
    default:
      return assertNever(element)
  }
}
