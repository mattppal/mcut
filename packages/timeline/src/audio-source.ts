import { assertNever } from './errors'
import type { AssetId, ElementId } from './id'
import { getMulticamAudioSource } from './multicam'
import type { AssetRef, Project, TimelineElement, Voice } from './model'
import { getElementLocation } from './selectors'
import { getSourceSpanMs, type TimeMap } from './speed'

export type ElementAudioSourceType = 'video' | 'audio' | 'multicam'

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

export function resolveElementAudioSource(project: Project, elementId: ElementId): ElementAudioSource | null {
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

export function getVoiceSource(project: Project, element: TimelineElement): { assetId: AssetId; amount: number } | null {
  const voice = elementVoice(element)
  if (!voice || !voice.enabled || voice.amount <= 0) return null
  const assetId = voiceAssetId(element)
  if (!assetId || !project.assets[assetId]) return null
  return { assetId, amount: voice.amount }
}

function elementVoice(element: TimelineElement): Voice | undefined {
  switch (element.type) {
    case 'video':
    case 'audio':
    case 'multicam':
      return element.voice
    case 'image':
    case 'text':
    case 'caption':
      return undefined
    default:
      return assertNever(element)
  }
}

function voiceAssetId(element: TimelineElement): AssetId | null {
  switch (element.type) {
    case 'video':
    case 'audio':
      return element.assetId
    case 'multicam':
      return getMulticamAudioSource(element)?.assetId ?? null
    case 'image':
    case 'text':
    case 'caption':
      return null
    default:
      return assertNever(element)
  }
}
