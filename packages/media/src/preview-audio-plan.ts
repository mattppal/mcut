import { interpolateTrack, type TimeMap } from '@mcut/timeline'
import type { AudibleSegment } from './export-audio-composite'
import type { FeedPlan } from './preview-audio-feed'
import { constantSpeedOf } from './time-stretch'

export interface AudioAnchor {
  timelineMs: number
  contextS: number
  rate: number
}

export interface OutputStamp {
  contextTime: number
  performanceTime: number
}

export function timelineAt(anchor: AudioAnchor, contextS: number): number {
  return anchor.timelineMs + Math.max(0, contextS - anchor.contextS) * 1000 * anchor.rate
}

export function contextAt(anchor: AudioAnchor, timelineMs: number): number {
  return anchor.contextS + (timelineMs - anchor.timelineMs) / 1000 / anchor.rate
}

export function heardContextS(stamp: OutputStamp, perfMs: number): number {
  return stamp.contextTime + (perfMs - stamp.performanceTime) / 1000
}

const STRETCH_PREROLL_MS = 250
const CROSSFADE_MS = 10
const REMAP_STEP_MS = 10

export interface WindowGate {
  openS: number
  fadeInS: number
  closeS: number | null
  fadeOutS: number
}

export interface PlannedWindow {
  segment: AudibleSegment
  gate: WindowGate
  endS: number
}

export interface PlannedFeed {
  plan: FeedPlan
  startS: number
  endS: number
}

export interface LinearMap {
  kind: 'linear'
  offsetMs: number
  speed: number
}

type SourceMap = LinearMap | { kind: 'curve'; timeMap: TimeMap }

export function sourceMapOf(segment: AudibleSegment): SourceMap {
  if (segment.reversed) return { kind: 'linear', offsetMs: 0, speed: segment.sourceSpanMs / Math.max(1, segment.durationMs) }
  if (!segment.timeMap) return { kind: 'linear', offsetMs: 0, speed: 1 }
  const constant = constantSpeedOf(segment.timeMap)
  return constant ? { kind: 'linear', offsetMs: constant.sourceStartOffsetMs, speed: constant.rate } : { kind: 'curve', timeMap: segment.timeMap }
}

export function planFeed(segment: AudibleSegment, { speed, offsetMs }: LinearMap, anchor: AudioAnchor, fromS: number): PlannedFeed | null {
  const headMs = Math.max(0, timelineAt(anchor, fromS) - segment.startMs)
  if (segment.durationMs - headMs <= 1e-6) return null
  const tempo = speed * anchor.rate
  const prerollMs = Math.abs(tempo - 1) > 1e-6 ? Math.min(headMs, STRETCH_PREROLL_MS * anchor.rate) : 0
  const sourceMs = segment.reversed ? segment.trimStartMs + segment.sourceSpanMs - speed * headMs : segment.trimStartMs + offsetMs + speed * headMs
  return {
    plan: {
      reversed: segment.reversed === true,
      sourceS: sourceMs / 1000,
      spanS: (speed * (segment.durationMs - headMs)) / 1000,
      prerollS: (speed * prerollMs) / 1000,
      tempo,
    },
    startS: contextAt(anchor, segment.startMs + headMs),
    endS: contextAt(anchor, segment.startMs + segment.durationMs),
  }
}

function curveRange(
  segment: AudibleSegment,
  curve: TimeMap,
  fromMs: number,
  toMs: number,
  rate: number,
): Pick<AudibleSegment, 'trimStartMs' | 'sourceSpanMs' | 'timeMap'> {
  const origin = interpolateTrack(curve, fromMs)
  const timeMap: TimeMap = []
  for (let localMs = fromMs; localMs < toMs; localMs += REMAP_STEP_MS) {
    timeMap.push({ timeMs: (localMs - fromMs) / rate, value: interpolateTrack(curve, localMs) - origin })
  }
  const sourceSpanMs = interpolateTrack(curve, toMs) - origin
  timeMap.push({ timeMs: (toMs - fromMs) / rate, value: sourceSpanMs })
  return { trimStartMs: segment.trimStartMs + origin, sourceSpanMs, timeMap }
}

export function planWindow(segment: AudibleSegment, curve: TimeMap, anchor: AudioAnchor, fromS: number, toS: number, crossfade: boolean): PlannedWindow | null {
  const rate = anchor.rate
  const headMs = Math.max(0, timelineAt(anchor, fromS) - segment.startMs)
  const tailMs = Math.min(segment.durationMs, timelineAt(anchor, toS) - segment.startMs)
  if (tailMs - headMs <= 1e-6) return null
  const overhangMs = tailMs < segment.durationMs ? Math.min(segment.durationMs - tailMs, CROSSFADE_MS * rate) : 0
  const toMs = tailMs + overhangMs
  const openS = contextAt(anchor, segment.startMs + headMs)
  const durationMs = (toMs - headMs) / rate
  return {
    segment: {
      elementId: segment.elementId,
      src: segment.src,
      startMs: openS * 1000,
      durationMs,
      ...curveRange(segment, curve, headMs, toMs, rate),
      volume: 1,
    },
    gate: {
      openS,
      fadeInS: crossfade ? CROSSFADE_MS / 1000 : 0,
      closeS: overhangMs > 0 ? openS + (tailMs - headMs) / rate / 1000 : null,
      fadeOutS: overhangMs / rate / 1000,
    },
    endS: openS + durationMs / 1000,
  }
}
