import { canPlaceIgnoring, type ClipDragBase, type ClipDragMode } from '@mcut/editor'
import { getElementLocation, MIN_ELEMENT_DURATION_MS, type BuiltinCommand, type ElementId, type Project, type TrackId } from '@mcut/timeline'
import { snapClip, snapTime, type SnapTarget } from './timeline-snap'

export const NEW_TRACK_ABOVE_ROW = -1

export interface ClipPreview {
  id: ElementId
  startMs: number
  durationMs: number
  row: number
}

export type DropTarget = { kind: 'lane'; trackId: TrackId } | { kind: 'new-track' } | null

export interface DragPlan {
  previews: ClipPreview[]
  commands: BuiltinCommand[]
  target: DropTarget
  valid: boolean
  guideMs: number | null
}

export interface PlanInput {
  project: Project
  mode: ClipDragMode
  ids: readonly ElementId[]
  bases: ReadonlyMap<ElementId, ClipDragBase>
  ignore: ReadonlySet<string>
  targets: readonly SnapTarget[]
  deltaRawMs: number
  snapping: boolean
  thresholdMs: number
  pointerRow: number | null
  newTrackId: TrackId | null
}

export function visualRow(project: Project, trackIndex: number): number {
  return project.tracks.length - 1 - trackIndex
}

function mustBase(bases: ReadonlyMap<ElementId, ClipDragBase>, id: ElementId): ClipDragBase {
  const base = bases.get(id)
  if (!base) throw new Error(`no drag base for ${id}`)
  return base
}

function preview(
  project: Project,
  id: ElementId,
  base: ClipDragBase,
  startMs: number,
  durationMs: number,
  row = visualRow(project, base.trackIndex),
): ClipPreview {
  return { id, startMs, durationMs, row }
}

function planMove(input: PlanInput): DragPlan {
  const { project, ids, bases, ignore, targets, deltaRawMs, snapping, thresholdMs, pointerRow, newTrackId } = input
  const anchorId = ids[0]
  if (anchorId === undefined) return { previews: [], commands: [], target: null, valid: false, guideMs: null }
  const anchor = mustBase(bases, anchorId)
  const snapped = snapClip(anchor.startMs + deltaRawMs, anchor.durationMs, targets, thresholdMs, { enabled: snapping, fps: project.fps })
  const minStart = Math.min(...ids.map((id) => mustBase(bases, id).startMs))
  const deltaMs = Math.max(Math.round(snapped.ms - anchor.startMs), -minStart)

  if (ids.length > 1) {
    const moves = ids.map((id) => {
      const base = mustBase(bases, id)
      return { id, base, startMs: base.startMs + deltaMs, track: project.tracks[base.trackIndex] }
    })
    const valid = moves.every(({ base, startMs, track }) => track && (track.magnetic || canPlaceIgnoring(track, startMs, base.durationMs, ignore)))
    return {
      previews: moves.map(({ id, base, startMs }) => preview(project, id, base, startMs, base.durationMs)),
      commands: deltaMs === 0 ? [] : moves.map(({ id, startMs }) => ({ type: 'moveElement', elementId: id, startMs })),
      target: null,
      valid,
      guideMs: valid ? snapped.guideMs : null,
    }
  }

  const trackCount = project.tracks.length
  const targetIndex = pointerRow === null ? anchor.trackIndex : trackCount - 1 - pointerRow
  const startMs = anchor.startMs + deltaMs
  if ((targetIndex >= trackCount || targetIndex < 0) && newTrackId !== null) {
    const above = targetIndex >= trackCount
    return {
      previews: [preview(project, anchorId, anchor, startMs, anchor.durationMs, above ? NEW_TRACK_ABOVE_ROW : trackCount)],
      commands: [
        { type: 'addTrack', id: newTrackId, ...(above ? {} : { index: 0 }) },
        { type: 'moveElement', elementId: anchorId, startMs, toTrackId: newTrackId },
      ],
      target: above ? { kind: 'new-track' } : null,
      valid: true,
      guideMs: snapped.guideMs,
    }
  }

  const clampedIndex = Math.max(0, Math.min(targetIndex, trackCount - 1))
  const track = project.tracks[clampedIndex]
  if (!track) return { previews: [], commands: [], target: null, valid: false, guideMs: null }
  const row = visualRow(project, clampedIndex)
  const magneticStartMs = Math.max(0, Math.round(anchor.startMs + deltaRawMs))
  const landingMs = track.magnetic ? magneticStartMs : startMs
  const valid = !track.locked && (track.magnetic || canPlaceIgnoring(track, landingMs, anchor.durationMs, ignore))
  const unchanged = clampedIndex === anchor.trackIndex && landingMs === anchor.startMs
  return {
    previews: [preview(project, anchorId, anchor, landingMs, anchor.durationMs, row)],
    commands: unchanged ? [] : [{ type: 'moveElement', elementId: anchorId, startMs: landingMs, toTrackId: track.id }],
    target: { kind: 'lane', trackId: track.id },
    valid,
    guideMs: valid && !track.magnetic ? snapped.guideMs : null,
  }
}

interface TrimMember {
  id: ElementId
  base: ClipDragBase
  assetDurationMs: number | undefined
}

function trimMembers(project: Project, ids: readonly ElementId[], bases: ReadonlyMap<ElementId, ClipDragBase>): TrimMember[] {
  return ids.flatMap((id) => {
    const base = bases.get(id)
    const element = getElementLocation(project, id)?.element
    if (!base || !element) return []
    const asset = 'assetId' in element ? project.assets[element.assetId] : undefined
    return [{ id, base, assetDurationMs: asset?.durationMs }]
  })
}

function planTrim(input: PlanInput, edge: 'start' | 'end'): DragPlan {
  const { project, ids, bases, ignore, targets, deltaRawMs, snapping, thresholdMs } = input
  const anchorId = ids[0]
  if (anchorId === undefined) return { previews: [], commands: [], target: null, valid: false, guideMs: null }
  const anchor = mustBase(bases, anchorId)
  const members = trimMembers(project, ids, bases)
  const edgeMs = edge === 'end' ? anchor.startMs + anchor.durationMs : anchor.startMs
  const snapped = snapTime(edgeMs + deltaRawMs, targets, thresholdMs, { enabled: snapping, fps: project.fps })
  const wanted = Math.round(snapped.ms) - edgeMs
  let deltaMs = wanted
  for (const { base, assetDurationMs } of members) {
    if (edge === 'end') {
      if (!base.hasTimeMap && assetDurationMs !== undefined && base.trimStartMs !== undefined) {
        deltaMs = Math.min(deltaMs, base.reversed ? base.trimStartMs : assetDurationMs - base.trimStartMs - base.durationMs)
      }
      deltaMs = Math.max(deltaMs, MIN_ELEMENT_DURATION_MS - base.durationMs)
      continue
    }
    deltaMs = Math.max(deltaMs, -base.startMs)
    if (!base.hasTimeMap && base.trimStartMs !== undefined) {
      deltaMs = Math.max(deltaMs, base.reversed && assetDurationMs !== undefined ? -(assetDurationMs - base.trimStartMs - base.durationMs) : -base.trimStartMs)
    }
    if (base.hasTimeMap && base.reversed) deltaMs = Math.max(deltaMs, 0)
    deltaMs = Math.min(deltaMs, base.durationMs - MIN_ELEMENT_DURATION_MS)
  }
  const shaped = members.map(({ id, base }) => ({
    id,
    base,
    startMs: edge === 'end' ? base.startMs : base.startMs + deltaMs,
    durationMs: edge === 'end' ? base.durationMs + deltaMs : base.durationMs - deltaMs,
  }))
  const valid = shaped.every(({ base, startMs, durationMs }) => {
    const track = project.tracks[base.trackIndex]
    return track !== undefined && canPlaceIgnoring(track, startMs, durationMs, ignore)
  })
  return {
    previews: shaped.map(({ id, base, startMs, durationMs }) => preview(project, id, base, startMs, durationMs)),
    commands: deltaMs === 0 ? [] : shaped.map(({ id }) => ({ type: 'trimEdge', elementId: id, edge, deltaMs })),
    target: null,
    valid,
    guideMs: valid && deltaMs === wanted ? snapped.guideMs : null,
  }
}

export function isPreviewMode(mode: ClipDragMode): mode is 'move' | 'trim-start' | 'trim-end' {
  return mode === 'move' || mode === 'trim-start' || mode === 'trim-end'
}

export function planClipDrag(input: PlanInput): DragPlan {
  switch (input.mode) {
    case 'move':
      return planMove(input)
    case 'trim-start':
      return planTrim(input, 'start')
    case 'trim-end':
      return planTrim(input, 'end')
    case 'ripple-start':
    case 'ripple-end':
    case 'roll-start':
    case 'roll-end':
    case 'slip':
    case 'slide':
      return { previews: [], commands: [], target: null, valid: false, guideMs: null }
    default: {
      const exhaustive: never = input.mode
      return exhaustive
    }
  }
}
