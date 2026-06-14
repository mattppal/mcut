import type { Layout } from './layouts'
import { getLayout } from './layouts'
import type { MulticamElement, MulticamSource, Project } from './model'
import { getSourceTimeMs } from './speed'

/**
 * Multicam helpers: a multicam element is N synced sources + an `angles`
 * switch list ({ atMs, layoutId } from each cut until the next). What
 * switches is the LAYOUT — "screen + me" vs "just me" are compositions of
 * the same sources — which keeps cuts as plain data an agent can read and
 * write. See .context/plans/mcut-multicam-zooms-thumbnails.md.
 */

export interface AngleCut {
  atMs: number
  layoutId: string
}

/** Index into `angles` of the cut active at element-local `localMs`. */
export function getActiveAngleIndex(angles: readonly AngleCut[], localMs: number): number {
  let active = 0
  for (let i = 0; i < angles.length; i++) {
    if (angles[i]!.atMs <= localMs) active = i
    else break
  }
  return active
}

/** The layout active at element-local `localMs` (null if id is dangling). */
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

/**
 * Source media time for one multicam source at an absolute timeline time.
 * The element-level timeMap (speed) applies first, then the source's trim.
 * Clamped ≥ 0 — render and frame-request enumeration must agree exactly.
 */
export function getMulticamSourceTimeMs(
  element: MulticamElement,
  source: MulticamSource,
  timelineMs: number,
): number {
  const localMs = timelineMs - element.startMs
  // getSourceTimeMs handles the timeMap; feed it the source's own trim.
  const mapped = getSourceTimeMs(
    { startMs: element.startMs, durationMs: element.durationMs, trimStartMs: source.trimStartMs, timeMap: element.timeMap },
    localMs,
  )
  return Math.max(0, mapped)
}

/**
 * Split an angle list at element-local `offsetMs` for a clip split: the left
 * half keeps cuts before the offset; the right half starts with the active
 * layout at the cut and rebases later cuts.
 */
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

/** The source whose audio plays (explicit key, else nothing). */
export function getMulticamAudioSource(element: MulticamElement): MulticamSource | null {
  if (!element.audioSource) return null
  return element.sources.find((s) => s.key === element.audioSource) ?? null
}

/** An angle-cut blend window active at some element-local time. */
export interface AngleTransitionWindow {
  type: string
  /** Effective window length: the configured duration, clamped per cut. */
  durationMs: number
  /** Element-local time of the cut the window centers on. */
  cutMs: number
  fromLayoutId: string
  toLayoutId: string
}

/**
 * The angle-cut transition window containing element-local `localMs`, or
 * null (no `angleTransition`, or between windows). Each window is centered
 * on its cut and clamped to half the span to the neighboring cuts (and the
 * element bounds), so consecutive windows never overlap — render, frame
 * requests, and export must all enumerate through this to agree.
 */
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
