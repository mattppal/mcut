import { assertNever } from './errors'
import type { AssetId, ElementId } from './id'
import { isMediaClip, type MediaClip } from './media-clip'
import type { AssetRef, Project } from './model'
import { getElementLocation } from './selectors'
import { getSourceSpanMs, type TimeMap } from './speed'

export interface ElementAudioSource {
  elementId: ElementId
  assetId: AssetId
  asset: AssetRef
  timelineStartMs: number
  timelineDurationMs: number
  sourceStartMs: number
  sourceEndMs: number
  sourceSpanMs: number
  timeMap?: TimeMap
  reversed: boolean
}

interface AudioOrigin {
  assetId: AssetId
  offsetMs: number
}

function audioOrigin(clip: MediaClip): AudioOrigin | null {
  switch (clip.type) {
    case 'video':
    case 'audio':
      return { assetId: clip.assetId, offsetMs: 0 }
    case 'multicam': {
      const source = clip.sources.find((s) => s.key === clip.audioSource)
      return source ? { assetId: source.assetId, offsetMs: source.offsetMs } : null
    }
    default:
      return assertNever(clip)
  }
}

export function resolveElementAudioSource(project: Project, elementId: ElementId): ElementAudioSource | null {
  const element = getElementLocation(project, elementId)?.element
  if (!element || !isMediaClip(element)) return null
  const origin = audioOrigin(element)
  const asset = origin ? project.assets[origin.assetId] : undefined
  if (!origin || !asset) return null
  const sourceSpanMs = getSourceSpanMs(element)
  const sourceStartMs = origin.offsetMs + element.trimStartMs
  return {
    elementId: element.id,
    assetId: origin.assetId,
    asset,
    timelineStartMs: element.startMs,
    timelineDurationMs: element.durationMs,
    sourceStartMs,
    sourceEndMs: sourceStartMs + sourceSpanMs,
    sourceSpanMs,
    ...(element.timeMap ? { timeMap: element.timeMap } : {}),
    reversed: element.reversed === true,
  }
}
