import type { Keyframe, Project, TextElement, TimelineElement, VideoElement } from '@mcut/timeline'
import type { Verdict } from './types'

export type Check = [label: string, ok: boolean]

export function verdictOf(checks: readonly Check[]): Verdict {
  const failing = checks.filter(([, ok]) => !ok).map(([label]) => label)
  return { pass: failing.length === 0, reasons: failing }
}

export const near = (actual: number, expected: number, toleranceMs: number): boolean =>
  Math.abs(actual - expected) <= toleranceMs

export function allElements(project: Project): TimelineElement[] {
  return project.tracks.flatMap((track) => track.elements)
}

export function videoClips(project: Project): VideoElement[] {
  return allElements(project)
    .filter((element): element is VideoElement => element.type === 'video')
    .sort((a, b) => a.startMs - b.startMs)
}

export function textElements(project: Project): TextElement[] {
  return allElements(project).filter((element): element is TextElement => element.type === 'text')
}

export function trackIndexOf(project: Project, elementId: string): number {
  return project.tracks.findIndex((track) => track.elements.some((element) => element.id === elementId))
}

export function totalDuration(clips: readonly VideoElement[]): number {
  return clips.reduce((sum, clip) => sum + clip.durationMs, 0)
}

export function buttCutsFromZero(clips: readonly VideoElement[]): boolean {
  let cursor = 0
  for (const clip of clips) {
    if (clip.startMs !== cursor) return false
    cursor += clip.durationMs
  }
  return clips.length > 0
}

const sourceEnd = (clip: VideoElement): number => clip.trimStartMs + clip.durationMs

export function sourceCovers(clips: readonly VideoElement[], startMs: number, endMs: number): boolean {
  return clips.some((clip) => clip.trimStartMs <= startMs && sourceEnd(clip) >= endMs)
}

export function sourceTouches(
  clips: readonly VideoElement[],
  startMs: number,
  endMs: number,
  slackMs: number,
): boolean {
  const from = startMs + slackMs
  const to = endMs - slackMs
  if (to <= from) return false
  return clips.some((clip) => clip.trimStartMs < to && sourceEnd(clip) > from)
}

export function opacityKeyframes(element: TimelineElement): Keyframe[] {
  const keyframes = element.keyframes?.opacity ?? []
  return [...keyframes].sort((a, b) => a.timeMs - b.timeMs)
}

export function hasKeyframeNear(
  keyframes: readonly Keyframe[],
  timeMs: number,
  value: number,
  toleranceMs: number,
): boolean {
  return keyframes.some((frame) => near(frame.timeMs, timeMs, toleranceMs) && near(frame.value, value, 0.01))
}
