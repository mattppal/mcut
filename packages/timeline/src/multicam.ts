import type { Layout } from './layouts'
import { getLayout } from './layouts'
import type { MulticamElement, MulticamSource, Project } from './model'
import { getSourceTimeMs } from './speed'
import type { TransitionType } from './transitions'

export interface AngleCut {
  atMs: number
  layoutId: string
}

export function getActiveAngleIndex(angles: readonly AngleCut[], localMs: number): number {
  let active = 0
  for (let i = 0; i < angles.length; i++) {
    if (angles[i]!.atMs <= localMs) active = i
    else break
  }
  return active
}

export function getActiveLayout(
  project: Project,
  element: MulticamElement,
  timelineMs: number,
): Layout | null {
  const localMs = timelineMs - element.startMs
  const cut = element.angles[getActiveAngleIndex(element.angles, localMs)]
  if (!cut) return null
  return getLayout(project.layouts, cut.layoutId)
}

export function getMulticamSourceTimeMs(
  element: MulticamElement,
  source: MulticamSource,
  timelineMs: number,
): number {
  const localMs = timelineMs - element.startMs
  const mapped = getSourceTimeMs(
    { startMs: element.startMs, durationMs: element.durationMs, trimStartMs: source.trimStartMs, timeMap: element.timeMap },
    localMs,
  )
  return Math.max(0, mapped)
}

export function splitAngles(
  angles: readonly AngleCut[],
  offsetMs: number,
): { left: AngleCut[]; right: AngleCut[] } {
  const activeIndex = getActiveAngleIndex(angles, offsetMs)
  const left = angles.filter((a) => a.atMs < offsetMs)
  const right = [
    { atMs: 0, layoutId: angles[activeIndex]!.layoutId },
    ...angles
      .filter((a) => a.atMs > offsetMs)
      .map((a) => ({ ...a, atMs: a.atMs - offsetMs })),
  ]
  return { left: left.length > 0 ? left : [{ atMs: 0, layoutId: angles[0]!.layoutId }], right }
}

export function getMulticamAudioSource(element: MulticamElement): MulticamSource | null {
  if (!element.audioSource) return null
  return element.sources.find((s) => s.key === element.audioSource) ?? null
}

export interface AngleTransitionWindow {
  type: TransitionType
  durationMs: number
  cutMs: number
  fromLayoutId: string
  toLayoutId: string
}

export function getAngleTransitionAt(
  element: MulticamElement,
  localMs: number,
): AngleTransitionWindow | null {
  const transition = element.angleTransition
  if (!transition) return null
  for (let i = 1; i < element.angles.length; i++) {
    const cut = element.angles[i]!
    const previous = element.angles[i - 1]!
    const nextAtMs = element.angles[i + 1]?.atMs ?? element.durationMs
    const half = Math.min(
      transition.durationMs / 2,
      (cut.atMs - previous.atMs) / 2,
      (nextAtMs - cut.atMs) / 2,
    )
    if (half <= 0) continue
    if (localMs >= cut.atMs - half && localMs < cut.atMs + half) {
      return {
        type: transition.type,
        durationMs: half * 2,
        cutMs: cut.atMs,
        fromLayoutId: previous.layoutId,
        toLayoutId: cut.layoutId,
      }
    }
  }
  return null
}
