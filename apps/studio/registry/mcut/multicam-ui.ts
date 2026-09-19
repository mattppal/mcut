import { getActiveAngleIndex, type EditorEngine, type MulticamElement, type Project } from '@mcut/timeline'

export interface LocatedMulticam {
  element: MulticamElement
  trackId: Project['tracks'][number]['id']
}

export function findTargetMulticam(project: Project, selectedIds: readonly string[], playheadMs: number): LocatedMulticam | null {
  let underPlayhead: LocatedMulticam | null = null
  let first: LocatedMulticam | null = null
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if (element.type !== 'multicam') continue
      const located = { element, trackId: track.id }
      if (selectedIds.includes(element.id)) return located
      if (!underPlayhead && playheadMs >= element.startMs && playheadMs < element.startMs + element.durationMs) {
        underPlayhead = located
      }
      if (!first) first = located
    }
  }
  return underPlayhead ?? first
}

export function switchToLayout(engine: EditorEngine, element: MulticamElement, layoutId: string): void {
  const playheadMs = engine.playback.state.currentTimeMs
  const localMs = Math.round(playheadMs - element.startMs)
  if (localMs < 0 || localMs >= element.durationMs) return
  try {
    if (engine.playback.state.isPlaying && localMs > 0) {
      engine.dispatch({ type: 'addAngleCut', elementId: element.id, atMs: localMs, layoutId })
    } else {
      const span = element.angles[getActiveAngleIndex(element.angles, localMs)]
      if (!span) return
      engine.dispatch({
        type: 'setAngleLayout',
        elementId: element.id,
        atMs: span.atMs,
        layoutId,
      })
    }
  } catch {}
}
