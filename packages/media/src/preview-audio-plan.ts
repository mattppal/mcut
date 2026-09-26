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
