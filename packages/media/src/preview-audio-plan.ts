import { interpolateTrack, type TimeMap } from '@mcut/timeline'
import type { AudibleSegment } from './export-audio-composite'
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

export function heardContextS(stamp: OutputStamp, frameTimeMs: number): number {
  return stamp.contextTime + (frameTimeMs - stamp.performanceTime) / 1000
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

type SourceMap = { kind: 'linear'; offsetMs: number; speed: number } | { kind: 'curve'; timeMap: TimeMap }

function sourceMapOf(segment: AudibleSegment): SourceMap {
  if (segment.reversed) return { kind: 'linear', offsetMs: 0, speed: segment.sourceSpanMs / Math.max(1, segment.durationMs) }
  if (!segment.timeMap) return { kind: 'linear', offsetMs: 0, speed: 1 }
  const constant = constantSpeedOf(segment.timeMap)
  return constant ? { kind: 'linear', offsetMs: constant.sourceStartOffsetMs, speed: constant.rate } : { kind: 'curve', timeMap: segment.timeMap }
}

type SourceRange = Pick<AudibleSegment, 'trimStartMs' | 'sourceSpanMs' | 'timeMap' | 'reversed'>

function sourceRange(segment: AudibleSegment, map: SourceMap, fromMs: number, toMs: number, rate: number, stretched: boolean): SourceRange {
  switch (map.kind) {
    case 'linear': {
      const sourceSpanMs = map.speed * (toMs - fromMs)
      if (segment.reversed) return { trimStartMs: segment.trimStartMs + segment.sourceSpanMs - map.speed * toMs, sourceSpanMs, reversed: true }
      const trimStartMs = segment.trimStartMs + map.offsetMs + map.speed * fromMs
      if (!stretched) return { trimStartMs, sourceSpanMs }
      return {
        trimStartMs,
        sourceSpanMs,
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: (toMs - fromMs) / rate, value: sourceSpanMs },
        ],
      }
    }
    case 'curve': {
      const origin = interpolateTrack(map.timeMap, fromMs)
      const timeMap: TimeMap = []
      for (let localMs = fromMs; localMs < toMs; localMs += REMAP_STEP_MS) {
        timeMap.push({ timeMs: (localMs - fromMs) / rate, value: interpolateTrack(map.timeMap, localMs) - origin })
      }
      const sourceSpanMs = interpolateTrack(map.timeMap, toMs) - origin
      timeMap.push({ timeMs: (toMs - fromMs) / rate, value: sourceSpanMs })
      return { trimStartMs: segment.trimStartMs + origin, sourceSpanMs, timeMap }
    }
    default: {
      const unhandled: never = map
      throw new Error(`Unknown source map ${JSON.stringify(unhandled)}`)
    }
  }
}

export function planWindow(segment: AudibleSegment, anchor: AudioAnchor, fromS: number, toS: number, crossfade: boolean): PlannedWindow | null {
  const rate = anchor.rate
  const headMs = Math.max(0, timelineAt(anchor, fromS) - segment.startMs)
  const tailMs = Math.min(segment.durationMs, timelineAt(anchor, toS) - segment.startMs)
  if (tailMs - headMs <= 1e-6) return null
  const map = sourceMapOf(segment)
  const stretched = map.kind === 'linear' && Math.abs(map.speed * rate - 1) > 1e-6
  const prerollMs = stretched ? Math.min(headMs, STRETCH_PREROLL_MS * rate) : 0
  const overhangMs = tailMs < segment.durationMs ? Math.min(segment.durationMs - tailMs, CROSSFADE_MS * rate) : 0
  const fromMs = headMs - prerollMs
  const toMs = tailMs + overhangMs
  const openS = contextAt(anchor, segment.startMs + headMs)
  const startMs = openS * 1000 - prerollMs / rate
  const durationMs = (toMs - fromMs) / rate
  return {
    segment: {
      elementId: segment.elementId,
      src: segment.src,
      startMs,
      durationMs,
      ...sourceRange(segment, map, fromMs, toMs, rate, stretched),
      volume: 1,
    },
    gate: {
      openS,
      fadeInS: crossfade ? CROSSFADE_MS / 1000 : 0,
      closeS: overhangMs > 0 ? openS + (tailMs - headMs) / rate / 1000 : null,
      fadeOutS: overhangMs / rate / 1000,
    },
    endS: (startMs + durationMs) / 1000,
  }
}
