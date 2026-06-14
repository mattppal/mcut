import type { Project, TimelineElement, Track } from './model'
import { getSourceSpanMs } from './speed'
import { getTransitionPair } from './transitions'

/**
 * OpenTimelineIO export: the project as an OTIO JSON document (the
 * `.otio` format read by Resolve, RV, Premiere via plugin, and the OTIO
 * toolchain).
 *
 * Mapping decisions:
 * - mcut times are integer ms; OTIO RationalTime uses rate 1000 (1 unit =
 *   1ms) so every value round-trips exactly. Consumers rescale to frames.
 * - Inter-clip spacing becomes explicit transparent Gaps (OTIO has no
 *   absolute clip positions).
 * - Transitions become zero-footprint OTIO Transitions after the left clip,
 *   with in/out offsets of half the (already clamped) window each.
 * - Speed ramps/freezes and multicam have no faithful core-schema peers and
 *   are flattened to their overall source span; the full element JSON rides
 *   in metadata.mcut for lossless reimport.
 * - Project markers attach to the top-level Stack.
 */
export interface OtioExportOptions {
  /** Frame rate stamped on marker/global ranges (default: project fps). */
  fps?: number
}

type OtioValue = Record<string, unknown>

const rationalTime = (valueMs: number): OtioValue => ({
  OTIO_SCHEMA: 'RationalTime.1',
  rate: 1000,
  value: Math.round(valueMs),
})

const timeRange = (startMs: number, durationMs: number): OtioValue => ({
  OTIO_SCHEMA: 'TimeRange.1',
  start_time: rationalTime(startMs),
  duration: rationalTime(durationMs),
})

function gap(durationMs: number): OtioValue {
  return {
    OTIO_SCHEMA: 'Gap.1',
    name: '',
    source_range: timeRange(0, durationMs),
    effects: [],
    markers: [],
    metadata: {},
  }
}

function mediaReference(project: Project, element: TimelineElement): OtioValue {
  const asset = 'assetId' in element ? project.assets[element.assetId] : undefined
  if (!asset) {
    return {
      OTIO_SCHEMA: 'MissingReference.1',
      name: 'name' in element && typeof element.name === 'string' ? element.name : element.type,
      metadata: {},
    }
  }
  return {
    OTIO_SCHEMA: 'ExternalReference.1',
    target_url: asset.src,
    ...(asset.durationMs !== undefined
      ? { available_range: timeRange(0, asset.durationMs) }
      : {}),
    metadata: { mcut: { assetId: asset.id, hash: asset.hash, name: asset.name } },
  }
}

function clip(project: Project, element: TimelineElement): OtioValue {
  const trimStartMs = 'trimStartMs' in element ? element.trimStartMs : 0
  // Time-mapped clips consume getSourceSpanMs() of source over durationMs of
  // output; core OTIO can't express the curve, so the source_range reports
  // the consumed span and the curve rides in metadata.
  const hasMap = 'timeMap' in element && element.timeMap !== undefined
  const sourceDurationMs = hasMap ? getSourceSpanMs(element as { durationMs: number }) : element.durationMs
  return {
    OTIO_SCHEMA: 'Clip.2',
    name: describeName(project, element),
    source_range: timeRange(trimStartMs, hasMap ? sourceDurationMs : element.durationMs),
    media_references: { DEFAULT_MEDIA: mediaReference(project, element) },
    active_media_reference_key: 'DEFAULT_MEDIA',
    effects: [],
    markers: [],
    metadata: { mcut: { element: JSON.parse(JSON.stringify(element)) } },
  }
}

function describeName(project: Project, element: TimelineElement): string {
  if ('assetId' in element) {
    return project.assets[element.assetId]?.name ?? element.assetId
  }
  if (element.type === 'text' || element.type === 'caption') return element.text.slice(0, 40)
  return element.type
}

function transition(type: string, durationMs: number): OtioValue {
  return {
    OTIO_SCHEMA: 'Transition.1',
    name: type,
    transition_type: type === 'dissolve' ? 'SMPTE_Dissolve' : 'Custom_Transition',
    // Zero-footprint: half the window from each adjacent clip's handles.
    in_offset: rationalTime(durationMs / 2),
    out_offset: rationalTime(durationMs / 2),
    metadata: { mcut: { type } },
  }
}

function otioTrack(project: Project, track: Track): OtioValue {
  const children: OtioValue[] = []
  let cursorMs = 0
  for (const element of track.elements) {
    if (element.startMs > cursorMs) children.push(gap(element.startMs - cursorMs))
    children.push(clip(project, element))
    const pair = getTransitionPair(track, element)
    if (pair) children.push(transition(pair.type, pair.durationMs))
    cursorMs = element.startMs + element.durationMs
  }
  const kind = track.elements.every((e) => e.type === 'audio') && track.elements.length > 0
    ? 'Audio'
    : 'Video'
  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.name,
    kind,
    children,
    effects: [],
    markers: [],
    metadata: {
      mcut: { trackId: track.id, muted: track.muted, hidden: track.hidden, locked: track.locked, magnetic: track.magnetic },
    },
  }
}

function marker(m: Project['markers'][number]): OtioValue {
  return {
    OTIO_SCHEMA: 'Marker.2',
    name: m.label ?? '',
    marked_range: timeRange(m.timeMs, 0),
    color: m.color ?? 'GREEN',
    metadata: { mcut: { id: m.id } },
  }
}

/** The project as an OTIO JSON document object (serialize with JSON.stringify). */
export function toOtio(project: Project, options: OtioExportOptions = {}): OtioValue {
  const fps = options.fps ?? project.fps
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: project.name,
    global_start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: fps, value: 0 },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      // OTIO stacks paint first-child on the bottom — same order as mcut.
      children: project.tracks.map((track) => otioTrack(project, track)),
      effects: [],
      markers: project.markers.map(marker),
      metadata: {},
    },
    metadata: {
      mcut: {
        projectId: project.id,
        fps: project.fps,
        width: project.width,
        height: project.height,
        version: project.version,
      },
    },
  }
}

/** The project serialized as `.otio` file contents. */
export function toOtioJson(project: Project, options: OtioExportOptions = {}): string {
  return JSON.stringify(toOtio(project, options), null, 2)
}
