import { type ClipDragBase, type ClipDragMode } from '@mcut/editor'
import { CommandError, getElementLocation, type EditorEngine, type ElementId, type TrackId } from '@mcut/timeline'
import { snapClip, snapTime, type SnapTarget } from './timeline-snap'

export type LiveMode = Exclude<ClipDragMode, 'move' | 'trim-start' | 'trim-end'>

interface LiveGesture {
  ids: readonly ElementId[]
  anchor: ClipDragBase
  targets: readonly SnapTarget[]
  appliedDeltaMs: number
  rollTargetId: ElementId | null
  slipRange: { minMs: number; maxMs: number } | null
}

interface LiveStepInput {
  deltaRawMs: number
  snapping: boolean
  thresholdMs: number
}

export function rethrowUnlessRejected(error: unknown): void {
  if (!(error instanceof CommandError)) throw error
}

export function removeEmptyCreatedTracks(engine: EditorEngine, trackIds: readonly TrackId[]) {
  for (const trackId of trackIds) {
    const track = engine.project.tracks.find((t) => t.id === trackId)
    if (track && track.elements.length === 0) {
      engine.dispatch({ type: 'removeTrack', trackId })
    }
  }
}

function slipDeltaOpposingThePointer(pointerDeltaMs: number): number {
  return -Math.round(pointerDeltaMs)
}

export function stepLiveGesture(
  engine: EditorEngine,
  mode: LiveMode,
  gesture: LiveGesture,
  { deltaRawMs, snapping, thresholdMs }: LiveStepInput,
): number | null {
  const project = engine.project
  const { anchor, targets } = gesture
  const anchorId = gesture.ids[0]
  if (anchorId === undefined) return null
  const snapOptions = { enabled: snapping, fps: project.fps }
  const apply = (wanted: number, dispatch: (stepMs: number) => void) => {
    const stepMs = wanted - gesture.appliedDeltaMs
    if (stepMs !== 0) {
      dispatch(stepMs)
      gesture.appliedDeltaMs = wanted
    }
  }

  switch (mode) {
    case 'slip': {
      const range = gesture.slipRange ?? { minMs: -Infinity, maxMs: Infinity }
      const wanted = Math.max(range.minMs, Math.min(range.maxMs, slipDeltaOpposingThePointer(deltaRawMs)))
      apply(wanted, (stepMs) => {
        for (const id of gesture.ids) {
          const element = getElementLocation(project, id)?.element
          if (!element) continue
          if (element.type !== 'video' && element.type !== 'audio' && element.type !== 'multicam') continue
          engine.dispatch({ type: 'slipElement', elementId: id, deltaMs: stepMs })
        }
      })
      return null
    }
    case 'slide': {
      const snapped = snapClip(anchor.startMs + deltaRawMs, anchor.durationMs, targets, thresholdMs, snapOptions)
      const wanted = Math.round(snapped.ms) - anchor.startMs
      apply(wanted, (stepMs) => engine.dispatch({ type: 'slideElement', elementId: anchorId, deltaMs: stepMs }))
      return gesture.appliedDeltaMs === wanted ? snapped.guideMs : null
    }
    case 'roll-start':
    case 'roll-end': {
      const cutBaseMs = mode === 'roll-end' ? anchor.startMs + anchor.durationMs : anchor.startMs
      const snapped = snapTime(cutBaseMs + deltaRawMs, targets, thresholdMs, snapOptions)
      const wanted = Math.round(snapped.ms) - cutBaseMs
      const rollId = mode === 'roll-end' ? anchorId : gesture.rollTargetId
      if (!rollId) return null
      apply(wanted, (stepMs) => engine.dispatch({ type: 'rollEdit', elementId: rollId, deltaMs: stepMs }))
      return gesture.appliedDeltaMs === wanted ? snapped.guideMs : null
    }
    case 'ripple-start':
    case 'ripple-end': {
      const edge = mode === 'ripple-end' ? 'end' : 'start'
      const edgeBaseMs = edge === 'end' ? anchor.startMs + anchor.durationMs : anchor.startMs
      const rippleTargets = targets.filter((t) => t.kind === 'marker' || t.kind === 'playhead' || t.kind === 'origin')
      const snapped = snapTime(edgeBaseMs + deltaRawMs, rippleTargets, thresholdMs, snapOptions)
      const wanted = Math.round(snapped.ms) - edgeBaseMs
      apply(wanted, (stepMs) => engine.dispatch({ type: 'rippleTrim', elementId: anchorId, edge, deltaMs: stepMs }))
      return gesture.appliedDeltaMs === wanted ? snapped.guideMs : null
    }
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}
