import type { Layout } from './layouts'
import { getLayout } from './layouts'
import type { MulticamElement, MulticamSource, Project } from './model'
import { getLocalTimeMs, getSourceTimeMs } from './speed'
import type { TransitionType } from './transitions'

export interface AngleCut {
  atMs: number
  layoutId: string
}

export function getActiveAngleIndex(angles: readonly AngleCut[], groupMs: number): number {
  let active = 0
  for (const [i, angle] of angles.entries()) {
    if (angle.atMs > groupMs) break
    active = i
  }
  return active
}

export function getMulticamGroupTimeMs(element: MulticamElement, timelineMs: number): number {
  return getSourceTimeMs(element, timelineMs - element.startMs)
}

export function getActiveLayout(project: Project, element: MulticamElement, timelineMs: number): Layout | null {
  const cut = element.angles[getActiveAngleIndex(element.angles, getMulticamGroupTimeMs(element, timelineMs))]
  if (!cut) return null
  return getLayout(project.layouts, cut.layoutId)
}

export function getMulticamSourceTimeMs(element: MulticamElement, source: MulticamSource, timelineMs: number): number {
  return Math.max(0, source.offsetMs + getMulticamGroupTimeMs(element, timelineMs))
}

export function isAudioOnlySource(project: Project, source: MulticamSource): boolean {
  return project.assets[source.assetId]?.kind === 'audio'
}

export interface VisibleAngleCut {
  atMs: number
  localMs: number
  layoutId: string
}

export function getVisibleAngleCuts(element: MulticamElement): VisibleAngleCut[] {
  const inPointMs = getSourceTimeMs(element, 0)
  const outPointMs = getSourceTimeMs(element, element.durationMs)
  const lowMs = Math.min(inPointMs, outPointMs)
  const highMs = Math.max(inPointMs, outPointMs)
  const cuts: VisibleAngleCut[] = []
  for (const [i, angle] of element.angles.entries()) {
    const previous = element.angles[i - 1]
    if (!previous || angle.atMs <= lowMs || angle.atMs >= highMs) continue
    const layoutId = element.reversed ? previous.layoutId : angle.layoutId
    cuts.push({ atMs: angle.atMs, localMs: getLocalTimeMs(element, angle.atMs), layoutId })
  }
  const opening = element.angles[getActiveAngleIndex(element.angles, inPointMs)]
  const first: VisibleAngleCut[] = opening ? [{ atMs: opening.atMs, localMs: 0, layoutId: opening.layoutId }] : []
  return [...first, ...cuts.sort((a, b) => a.localMs - b.localMs)]
}

export interface AngleTransitionWindow {
  type: TransitionType
  durationMs: number
  cutMs: number
  fromLayoutId: string
  toLayoutId: string
}

export function getAngleTransitionAt(element: MulticamElement, groupMs: number): AngleTransitionWindow | null {
  const transition = element.angleTransition
  if (!transition) return null
  for (const [i, cut] of element.angles.entries()) {
    const previous = element.angles[i - 1]
    if (!previous) continue
    const next = element.angles[i + 1]
    const half = Math.min(transition.durationMs / 2, (cut.atMs - previous.atMs) / 2, next ? (next.atMs - cut.atMs) / 2 : Infinity)
    if (half <= 0) continue
    if (groupMs >= cut.atMs - half && groupMs < cut.atMs + half) {
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
