import type { AssetId, ElementId } from './id'
import { getMulticamAudioSource } from './multicam'
import type { AssetRef, Project } from './model'
import { getElementLocation } from './selectors'
import { getSourceSpanMs, type TimeMap } from './speed'

export type ElementAudioSourceType = 'video' | 'audio' | 'multicam'

/**
 * Normalized answer to "what source audio does this timeline element play?"
 * UI and agent surfaces can use this before passing bytes to a transcription
 * provider, waveform analyzer, or any other media-only primitive.
 */
export interface ElementAudioSource {
  elementId: ElementId
  elementType: ElementAudioSourceType
  assetId: AssetId
  asset: AssetRef
  timelineStartMs: number
  timelineDurationMs: number
  sourceStartMs: number
  sourceEndMs: number
  sourceSpanMs: number
  timeMap?: TimeMap
  reversed: boolean
  multicamSourceKey?: string
}

export function resolveElementAudioSource(
  project: Project,
  elementId: ElementId,
): ElementAudioSource | null {
  const element = getElementLocation(project, elementId)?.element
  if (!element) return null

  if (element.type === 'video' || element.type === 'audio') {
    const asset = project.assets[element.assetId]
    if (!asset) return null
    const sourceSpanMs = getSourceSpanMs(element)
    return {
      elementId: element.id,
      elementType: element.type,
      assetId: element.assetId,
      asset,
      timelineStartMs: element.startMs,
      timelineDurationMs: element.durationMs,
      sourceStartMs: element.trimStartMs,
      sourceEndMs: element.trimStartMs + sourceSpanMs,
      sourceSpanMs,
      ...(element.timeMap ? { timeMap: element.timeMap } : {}),
      reversed: !!element.reversed,
    }
  }

  if (element.type === 'multicam') {
    const source = getMulticamAudioSource(element)
    const asset = source ? project.assets[source.assetId] : undefined
    if (!source || !asset) return null
    const sourceSpanMs = getSourceSpanMs(element)
    return {
      elementId: element.id,
      elementType: element.type,
      assetId: source.assetId,
      asset,
      timelineStartMs: element.startMs,
      timelineDurationMs: element.durationMs,
      sourceStartMs: source.trimStartMs,
      sourceEndMs: source.trimStartMs + sourceSpanMs,
      sourceSpanMs,
      ...(element.timeMap ? { timeMap: element.timeMap } : {}),
      reversed: false,
      multicamSourceKey: source.key,
    }
  }

  return null
}
