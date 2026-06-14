import { z } from 'zod'
import { CommandError } from './errors'
import { getElementType } from './element-registry'
import type { AssetId, ElementId, MarkerId, TrackId } from './id'
import { createElementId, createLinkId, createMarkerId, createTrackId } from './id'
import {
  assetIdSchema,
  assetRefSchema,
  captionStyleSchema,
  captionWordSchema,
  elementIdSchema,
  elementInputSchema,
  elementSchema,
  markerIdSchema,
  trackIdSchema,
  MIN_ELEMENT_DURATION_MS,
  type CaptionElement,
  type Project,
  type TimelineElement,
  type Track,
} from './model'
import {
  animatableProperties,
  animatablePropertySchema,
  easingSchema,
  elementSupportsProperty,
  splitKeyframes,
  upsertKeyframe,
  type AnimatableProperty,
  type Keyframe,
} from './keyframes'
import {
  animationPresetOptionsSchema,
  animationPresetSchema,
  expandAnimationPreset,
  MOTION_BLUR_PRESETS,
} from './animation-presets'
import {
  getSourceSpanMs,
  makeConstantSpeedMap,
  splitTimeMap,
  timeMapSchema,
} from './speed'
import { blendModeSchema, effectSchema, motionBlurSchema, type Effect } from './effects'
import { createDefaultLayouts, layoutSchema } from './layouts'
import { propertyPresetSchema } from './presets'
import { expandZoomPreset, zoomPresetSchema } from './zoom-presets'
import {
  expandThumbnailTemplate,
  findThumbnailTrack,
  THUMBNAIL_TRACK_NAME,
  thumbnailTemplateSchema,
} from './thumbnails'
import { splitAngles } from './multicam'
import { applyEdgeTrim } from './edge-trim'
import { getTransitionPair, transitionSchema } from './transitions'
import { getElementLocation, getTrack, rangesOverlap } from './selectors'

export { CommandError } from './errors'

/**
 * A command definition: a serializable edit operation with a validated
 * payload and a pure reducer. Definitions double as machine-readable tool
 * descriptions, so AI integrations can expose every editor operation as a
 * tool (`schema` → tool parameters) without extra glue.
 */
export interface CommandDefinition<TPayload = unknown> {
  type: string
  description: string
  payloadSchema: z.ZodType<TPayload, unknown>
  reduce: (project: Project, payload: TPayload) => Project
}

const registry = new Map<string, CommandDefinition<unknown>>()

/** Register a custom command. Throws if `type` is already registered. */
export function registerCommand<TPayload>(definition: CommandDefinition<TPayload>): void {
  if (registry.has(definition.type)) {
    throw new CommandError('duplicate-command', `command "${definition.type}" is already registered`)
  }
  registry.set(definition.type, definition as CommandDefinition<unknown>)
}

export function getCommandDefinition(type: string): CommandDefinition<unknown> | undefined {
  return registry.get(type)
}

/** All registered commands (built-in and custom), for docs and AI tooling. */
export function listCommands(): CommandDefinition<unknown>[] {
  return [...registry.values()]
}

/**
 * An MCP-shaped tool definition (a `tools/list` result entry): `type` →
 * `name`, the zod payload schema → JSON Schema `inputSchema`. Hand these to
 * an MCP server or any LLM tool-call API as-is.
 */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** Every registered command as an MCP-shaped tool definition. */
export function listToolDefinitions(): ToolDefinition[] {
  return listCommands().map(({ type, description, payloadSchema }) => {
    let inputSchema: Record<string, unknown>
    try {
      inputSchema = z.toJSONSchema(payloadSchema, {
        unrepresentable: 'any',
        io: 'input',
      }) as Record<string, unknown>
    } catch {
      inputSchema = { type: 'object' }
    }
    return { name: type, description, inputSchema }
  })
}

/** A serializable command object: `{ type, ...payload }`. */
export type AnyCommand = { type: string } & Record<string, unknown>

/**
 * Validate and apply a command to a project. Pure: returns a new project,
 * never mutates. Throws {@link CommandError} on unknown commands, invalid
 * payloads, or violated invariants (unknown ids, overlapping elements, ...).
 */
export function applyCommand(project: Project, command: AnyCommand): Project {
  const definition = registry.get(command.type)
  if (!definition) {
    throw new CommandError('unknown-command', `unknown command "${command.type}"`)
  }
  const { type: _type, ...payload } = command
  const parsed = definition.payloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new CommandError(
      'invalid-payload',
      `invalid payload for "${command.type}": ${parsed.error.message}`,
      { cause: parsed.error },
    )
  }
  return definition.reduce(project, parsed.data)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mustGetTrack(project: Project, trackId: TrackId): Track {
  const track = getTrack(project, trackId)
  if (!track) throw new CommandError('unknown-track', `no track "${trackId}"`)
  return track
}

function mustLocate(project: Project, elementId: ElementId) {
  const location = getElementLocation(project, elementId)
  if (!location) throw new CommandError('unknown-element', `no element "${elementId}"`)
  return location
}

function replaceTrack(project: Project, trackId: TrackId, update: (track: Track) => Track): Project {
  const next = {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? update(t) : t)),
  }
  return compactTimelineIfMagnetic(next)
}

function assertNoOverlap(track: Track, element: TimelineElement, ignoreId?: ElementId): void {
  // Magnetic tracks have no overlap invariant — ORDER is the invariant, and
  // compaction re-packs after every edit. Requested positions only choose a
  // slot (see placeMagnetic).
  if (track.magnetic) return
  const conflict = track.elements.find(
    (e) =>
      e.id !== ignoreId &&
      e.id !== element.id &&
      rangesOverlap(element.startMs, element.durationMs, e.startMs, e.durationMs),
  )
  if (conflict) {
    throw new CommandError(
      'overlap',
      `element would overlap "${conflict.id}" on track "${track.id}" ` +
        `(use findNearestFreeSlot to clamp before dispatching)`,
    )
  }
}

/**
 * Slot placement for magnetic tracks (the sortable-list rule): the element's
 * requested LEFT EDGE picks its slot — it sorts before the first neighbor
 * whose slot midpoint it hasn't passed. Stable and reversible mid-drag: the
 * other clips' mutual order never changes during a gesture, so their packed
 * boundaries are constant and the chosen index depends only on the pointer.
 * Returns the element with `startMs` rewritten to its slot boundary so
 * compaction agrees with the chosen order.
 */
function placeMagnetic(track: Track, element: TimelineElement): TimelineElement {
  const others = track.elements.filter((e) => e.id !== element.id)
  let boundary = 0
  for (const other of others) {
    if (element.startMs < boundary + other.durationMs / 2) break
    boundary += other.durationMs
  }
  return { ...element, startMs: boundary }
}

/** Insert keeping sort order; on magnetic tracks the slot rule places it. */
function insertPlaced(track: Track, element: TimelineElement): TimelineElement[] {
  const placed = track.magnetic ? placeMagnetic(track, element) : element
  const without = track.elements.filter((e) => e.id !== element.id)
  // Ties at a slot boundary: the placed element comes first (it claimed the slot).
  const index = without.findIndex((e) => e.startMs >= placed.startMs)
  if (index === -1) return [...without, placed]
  return [...without.slice(0, index), placed, ...without.slice(index)]
}

/** Element-type validation: the registry hook is the single source of truth. */
function validateElement(project: Project, element: TimelineElement): void {
  getElementType(element.type)?.validate?.(project, element as Record<string, unknown>)
}

function insertSorted(elements: TimelineElement[], element: TimelineElement): TimelineElement[] {
  const index = elements.findIndex((e) => e.startMs > element.startMs)
  if (index === -1) return [...elements, element]
  return [...elements.slice(0, index), element, ...elements.slice(index)]
}

function compactElements(elements: TimelineElement[]): TimelineElement[] {
  let cursorMs = 0
  return [...elements]
    .sort((a, b) => a.startMs - b.startMs)
    .map((element) => {
      const startMs = cursorMs
      cursorMs += element.durationMs
      return element.startMs === startMs ? element : { ...element, startMs }
    })
}

function compactTimelineGaps(project: Project): Project {
  return { ...project, tracks: project.tracks.map((track) => ({ ...track, elements: compactElements(track.elements) })) }
}

function compactTimelineIfMagnetic(project: Project): Project {
  return project.tracks.some((track) => track.magnetic) ? compactTimelineGaps(project) : project
}

function defineCommand<TSchema extends z.ZodType>(definition: {
  type: string
  description: string
  payloadSchema: TSchema
  reduce: (project: Project, payload: z.output<TSchema>) => Project
}): void {
  registerCommand(definition as CommandDefinition<z.output<TSchema>>)
}

// ---------------------------------------------------------------------------
// Built-in commands
// ---------------------------------------------------------------------------

const addTrackSchema = z.object({
  id: trackIdSchema.optional(),
  name: z.string().optional(),
  /** Insert position in paint order; defaults to topmost (end). */
  index: z.number().int().nonnegative().optional(),
})

defineCommand({
  type: 'addTrack',
  description: 'Add a new track. Tracks later in the list render on top.',
  payloadSchema: addTrackSchema,
  reduce: (project, payload) => {
    const timelineMagnetEnabled = project.tracks.some((t) => t.magnetic)
    const track: Track = {
      id: payload.id ?? createTrackId(),
      name: payload.name ?? `Track ${project.tracks.length + 1}`,
      muted: false,
      hidden: false,
      locked: false,
      magnetic: timelineMagnetEnabled,
      elements: [],
    }
    if (project.tracks.some((t) => t.id === track.id)) {
      throw new CommandError('duplicate-track', `track "${track.id}" already exists`)
    }
    const index = Math.min(payload.index ?? project.tracks.length, project.tracks.length)
    const tracks = [...project.tracks.slice(0, index), track, ...project.tracks.slice(index)]
    return { ...project, tracks }
  },
})

defineCommand({
  type: 'removeTrack',
  description: 'Remove a track and all elements on it.',
  payloadSchema: z.object({ trackId: trackIdSchema }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return { ...project, tracks: project.tracks.filter((t) => t.id !== payload.trackId) }
  },
})

defineCommand({
  type: 'renameTrack',
  description: 'Rename a track.',
  payloadSchema: z.object({ trackId: trackIdSchema, name: z.string().min(1) }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return replaceTrack(project, payload.trackId, (t) => ({ ...t, name: payload.name }))
  },
})

defineCommand({
  type: 'setTrackFlags',
  description: 'Mute (audio), hide (visuals), lock, or magnetically compact a track.',
  payloadSchema: z.object({
    trackId: trackIdSchema,
    muted: z.boolean().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    magnetic: z.boolean().optional(),
  }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return replaceTrack(project, payload.trackId, (t) => ({
      ...t,
      muted: payload.muted ?? t.muted,
      hidden: payload.hidden ?? t.hidden,
      locked: payload.locked ?? t.locked,
      magnetic: payload.magnetic ?? t.magnetic,
    }))
  },
})

defineCommand({
  type: 'compactTrackGaps',
  description: 'Close every gap on one track by packing clips left in timeline order.',
  payloadSchema: z.object({ trackId: trackIdSchema }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return replaceTrack(project, payload.trackId, (t) => ({ ...t, elements: compactElements(t.elements) }))
  },
})

defineCommand({
  type: 'compactTimelineGaps',
  description: 'Close every gap on the timeline by packing clips left on every track.',
  payloadSchema: z.object({}),
  reduce: (project) => compactTimelineGaps(project),
})

defineCommand({
  type: 'reorderTrack',
  description: 'Move a track to a new position in the paint order.',
  payloadSchema: z.object({ trackId: trackIdSchema, toIndex: z.number().int().nonnegative() }),
  reduce: (project, payload) => {
    const from = project.tracks.findIndex((t) => t.id === payload.trackId)
    if (from === -1) throw new CommandError('unknown-track', `no track "${payload.trackId}"`)
    const to = Math.min(payload.toIndex, project.tracks.length - 1)
    if (from === to) return project
    const tracks = [...project.tracks]
    const [track] = tracks.splice(from, 1)
    tracks.splice(to, 0, track!)
    return { ...project, tracks }
  },
})

defineCommand({
  type: 'updateProject',
  description: 'Update project settings (name, dimensions, fps).',
  payloadSchema: z.object({
    name: z.string().min(1).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
  }),
  reduce: (project, payload) => ({ ...project, ...payload }),
})

defineCommand({
  type: 'addAsset',
  description: 'Register a media asset (video, audio, or image) for use by elements.',
  payloadSchema: z.object({ asset: assetRefSchema }),
  reduce: (project, payload) => {
    if (project.assets[payload.asset.id]) {
      throw new CommandError('duplicate-asset', `asset "${payload.asset.id}" already exists`)
    }
    return { ...project, assets: { ...project.assets, [payload.asset.id]: payload.asset } }
  },
})

defineCommand({
  type: 'updateAsset',
  description: 'Patch asset metadata (e.g. probed duration or dimensions).',
  payloadSchema: z.object({
    assetId: assetIdSchema,
    patch: assetRefSchema.partial().omit({ id: true }),
  }),
  reduce: (project, payload) => {
    const asset = project.assets[payload.assetId]
    if (!asset) throw new CommandError('unknown-asset', `no asset "${payload.assetId}"`)
    return {
      ...project,
      assets: { ...project.assets, [payload.assetId]: { ...asset, ...payload.patch } },
    }
  },
})

defineCommand({
  type: 'removeAsset',
  description: 'Remove an asset and every element that references it.',
  payloadSchema: z.object({ assetId: assetIdSchema }),
  reduce: (project, payload) => {
    if (!project.assets[payload.assetId]) {
      throw new CommandError('unknown-asset', `no asset "${payload.assetId}"`)
    }
    const assets = { ...project.assets }
    delete assets[payload.assetId]
    const tracks = project.tracks.map((track) => ({
        ...track,
        elements: track.elements.filter(
          (e) => !('assetId' in e) || e.assetId !== payload.assetId,
        ),
      }))
    return compactTimelineIfMagnetic({ ...project, assets, tracks })
  },
})

/**
 * Kdenlive's explicit edit-mode taxonomy: collisions are rejected by default
 * (`normal`); destructive (`overwrite`) and rippling (`insert`) placement are
 * modes the caller opts into per command. Magnetic tracks ignore the mode —
 * slot placement is their whole contract.
 */
const editModeSchema = z.enum(['normal', 'overwrite', 'insert']).default('normal')

/**
 * Overwrite-mode carve: clear `[startMs, startMs+durationMs)` on the track by
 * trimming, splitting, or removing whatever occupies it. Sub-minimum
 * leftovers are dropped.
 */
function carveOverwriteRange(
  project: Project,
  trackId: TrackId,
  startMs: number,
  durationMs: number,
): Project {
  const endMs = startMs + durationMs
  return replaceTrack(project, trackId, (track) => {
    const elements: TimelineElement[] = []
    for (const element of track.elements) {
      if (!rangesOverlap(startMs, durationMs, element.startMs, element.durationMs)) {
        elements.push(element)
        continue
      }
      const elementEndMs = element.startMs + element.durationMs
      const headMs = startMs - element.startMs
      const tailMs = elementEndMs - endMs
      if (headMs >= MIN_ELEMENT_DURATION_MS) {
        const left = applyEdgeTrim(element, 'end', startMs - elementEndMs)
        // Its next-door neighbor is now the overwriting clip.
        if ('transition' in left) delete left.transition
        elements.push(left)
      }
      if (tailMs >= MIN_ELEMENT_DURATION_MS) {
        const right = applyEdgeTrim(element, 'start', endMs - element.startMs)
        elements.push(
          headMs >= MIN_ELEMENT_DURATION_MS ? { ...right, id: createElementId() } : right,
        )
      }
    }
    return { ...track, elements: sortByStart(elements) }
  })
}

/**
 * Insert-mode ripple: open a `durationMs` gap at `atMs`. A clip straddling
 * the point on the target track splits there; everything at or after the
 * point shifts right on every unlocked track (straddlers on other tracks
 * stay — cross-track splitting is not attempted).
 */
function rippleOpenGap(
  project: Project,
  targetTrackId: TrackId,
  atMs: number,
  durationMs: number,
): Project {
  const tracks = project.tracks.map((track) => {
    const isTarget = track.id === targetTrackId
    if (track.locked && !isTarget) return track
    const elements: TimelineElement[] = []
    for (const element of track.elements) {
      const elementEndMs = element.startMs + element.durationMs
      if (element.startMs >= atMs) {
        elements.push({ ...element, startMs: element.startMs + durationMs })
        continue
      }
      if (isTarget && elementEndMs > atMs) {
        const headMs = atMs - element.startMs
        const tailMs = elementEndMs - atMs
        if (headMs < MIN_ELEMENT_DURATION_MS) {
          // Effectively at the point: shift it whole.
          elements.push({ ...element, startMs: element.startMs + durationMs })
        } else if (tailMs < MIN_ELEMENT_DURATION_MS) {
          // A sub-minimum tail sliver would survive: trim it away instead.
          elements.push(applyEdgeTrim(element, 'end', atMs - elementEndMs))
        } else {
          const left = applyEdgeTrim(element, 'end', atMs - elementEndMs)
          if ('transition' in left) delete left.transition
          const right = applyEdgeTrim(element, 'start', headMs)
          elements.push(left, { ...right, id: createElementId(), startMs: atMs + durationMs })
        }
        continue
      }
      elements.push(element)
    }
    return { ...track, elements: sortByStart(elements) }
  })
  return { ...project, tracks }
}

/** Shared placement tail for addElement/moveElement: mode, overlap, insert. */
function placeElement(
  project: Project,
  trackId: TrackId,
  element: TimelineElement,
  editMode: z.output<typeof editModeSchema>,
): Project {
  const track = mustGetTrack(project, trackId)
  const mode = track.magnetic ? 'normal' : editMode
  let next = project
  if (mode === 'overwrite') {
    next = carveOverwriteRange(next, trackId, element.startMs, element.durationMs)
  } else if (mode === 'insert') {
    next = rippleOpenGap(next, trackId, element.startMs, element.durationMs)
  }
  assertNoOverlap(mustGetTrack(next, trackId), element)
  return replaceTrack(next, trackId, (t) => ({
    ...t,
    elements: insertPlaced(t, element),
  }))
}

defineCommand({
  type: 'addElement',
  description:
    'Add an element to a track. Elements on a track may not overlap in time. ' +
    'editMode "normal" (default) rejects collisions; "overwrite" clears the ' +
    'landing range; "insert" splits at the point and ripples everything after ' +
    'it right on every unlocked track. Omit `element.id` to have one generated.',
  payloadSchema: z.object({
    trackId: trackIdSchema,
    element: elementInputSchema,
    editMode: editModeSchema,
  }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    const element = { ...payload.element, id: payload.element.id ?? createElementId() }
    if (getElementLocation(project, element.id)) {
      throw new CommandError('duplicate-element', `element "${element.id}" already exists`)
    }
    validateElement(project, element)
    return placeElement(project, payload.trackId, element, payload.editMode)
  },
})

defineCommand({
  type: 'removeElement',
  description: 'Remove an element from the timeline.',
  payloadSchema: z.object({ elementId: elementIdSchema }),
  reduce: (project, payload) => {
    const { track } = mustLocate(project, payload.elementId)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.filter((e) => e.id !== payload.elementId),
    }))
  },
})

defineCommand({
  type: 'moveElement',
  description:
    'Move an element in time and optionally to another track. editMode ' +
    '"normal" (default) rejects collisions; "overwrite" clears the landing ' +
    'range; "insert" ripples clips after the landing point right.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    startMs: z.number().int().nonnegative(),
    toTrackId: trackIdSchema.optional(),
    editMode: editModeSchema,
  }),
  reduce: (project, payload) => {
    const { track: fromTrack, element } = mustLocate(project, payload.elementId)
    const targetTrackId = payload.toTrackId ?? fromTrack.id
    mustGetTrack(project, targetTrackId)
    const moved: TimelineElement = { ...element, startMs: payload.startMs }
    const removed = replaceTrack(project, fromTrack.id, (t) => ({
      ...t,
      elements: t.elements.filter((e) => e.id !== element.id),
    }))
    return placeElement(removed, targetTrackId, moved, payload.editMode)
  },
})

defineCommand({
  type: 'trimElement',
  description:
    'Set element timing. `startMs`/`durationMs` position it on the timeline; ' +
    '`trimStartMs` (video/audio) offsets into the source media.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    startMs: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().min(MIN_ELEMENT_DURATION_MS).optional(),
    trimStartMs: z.number().int().nonnegative().optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const trimmed: TimelineElement = {
      ...element,
      startMs: payload.startMs ?? element.startMs,
      durationMs: payload.durationMs ?? element.durationMs,
    }
    if (payload.trimStartMs !== undefined) {
      if (trimmed.type !== 'video' && trimmed.type !== 'audio') {
        throw new CommandError('invalid-payload', 'trimStartMs only applies to video/audio elements')
      }
      trimmed.trimStartMs = payload.trimStartMs
    }
    validateElement(project, trimmed)
    assertNoOverlap(track, trimmed, element.id)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: insertPlaced(t, trimmed),
    }))
  },
})

defineCommand({
  type: 'splitElement',
  description: 'Split an element at an absolute timeline time into two elements.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().positive(),
    /** Id for the right-hand element; generated when omitted. */
    rightElementId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const offset = payload.atMs - element.startMs
    if (offset < MIN_ELEMENT_DURATION_MS || element.durationMs - offset < MIN_ELEMENT_DURATION_MS) {
      throw new CommandError(
        'out-of-bounds',
        `cannot split "${element.id}" at ${payload.atMs}ms: both halves must be at least ` +
          `${MIN_ELEMENT_DURATION_MS}ms long`,
      )
    }
    const left: TimelineElement = { ...element, durationMs: offset }
    const right: TimelineElement = {
      ...element,
      id: payload.rightElementId ?? createElementId(),
      startMs: element.startMs + offset,
      durationMs: element.durationMs - offset,
    }
    // A transition belongs to the cut at the clip's END; the right half owns
    // that cut now. (The halves' own butt cut gets no transition.)
    if ('transition' in left) delete left.transition
    if ('keyframes' in element && element.keyframes) {
      // Continuity across the cut: both halves get an evaluated boundary
      // keyframe, so armed motion doesn't jump (Premiere behavior).
      const split = splitKeyframes(element.keyframes, offset)
      if (split.left) left.keyframes = split.left
      else delete left.keyframes
      if (split.right) right.keyframes = split.right
      else delete right.keyframes
    }
    // Type-specific source bookkeeping (trims, timeMaps, angle lists, word
    // timings) lives on the element type's onSplit hook.
    getElementType(element.type)?.onSplit?.({
      element: element as Record<string, unknown>,
      left: left as Record<string, unknown>,
      right: right as Record<string, unknown>,
      offsetMs: offset,
    })
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: insertSorted(
        insertSorted(
          t.elements.filter((e) => e.id !== element.id),
          left,
        ),
        right,
      ),
    }))
  },
})

defineCommand({
  type: 'updateElement',
  description:
    'Patch element properties (text, style, transform, opacity, volume, ...). ' +
    'The merged element is re-validated; `id` and `type` cannot change.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    patch: z.record(z.string(), z.unknown()),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if ('id' in payload.patch || 'type' in payload.patch) {
      throw new CommandError('invalid-payload', 'patch may not change "id" or "type"')
    }
    const merged = elementSchema.safeParse({ ...element, ...payload.patch })
    if (!merged.success) {
      throw new CommandError(
        'invalid-payload',
        `patch produces an invalid element: ${merged.error.message}`,
        { cause: merged.error },
      )
    }
    validateElement(project, merged.data)
    assertNoOverlap(track, merged.data, element.id)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: insertPlaced(t, merged.data),
    }))
  },
})

const applyCaptionsSchema = z.object({
  /** Target track; when omitted, a "Captions" track is created on top. */
  trackId: trackIdSchema.optional(),
  /** Replace existing captions on the target track (default true). */
  replace: z.boolean().default(true),
  captions: z.array(
    z.object({
      id: elementIdSchema.optional(),
      startMs: z.number().int().nonnegative(),
      durationMs: z.number().int().min(MIN_ELEMENT_DURATION_MS),
      text: z.string(),
      words: z.array(captionWordSchema).optional(),
      style: captionStyleSchema,
    }),
  ),
})

defineCommand({
  type: 'applyCaptions',
  description:
    'Add caption elements (e.g. from a transcription) to a caption track, ' +
    'creating the track when needed.',
  payloadSchema: applyCaptionsSchema,
  reduce: (project, payload) => {
    let next = project
    let trackId = payload.trackId
    if (trackId) {
      mustGetTrack(next, trackId)
    } else {
      const existing = next.tracks.find(
        (t) => t.elements.length > 0 && t.elements.every((e) => e.type === 'caption'),
      )
      if (existing) {
        trackId = existing.id
      } else {
        trackId = createTrackId()
        const timelineMagnetEnabled = next.tracks.some((t) => t.magnetic)
        next = {
          ...next,
          tracks: [
            ...next.tracks,
            {
              id: trackId,
              name: 'Captions',
              muted: false,
              hidden: false,
              locked: false,
              magnetic: timelineMagnetEnabled,
              elements: [],
            },
          ],
        }
      }
    }
    const finalTrackId = trackId
    if (payload.replace) {
      next = replaceTrack(next, finalTrackId, (t) => ({
        ...t,
        elements: t.elements.filter((e) => e.type !== 'caption'),
      }))
    }
    for (const caption of payload.captions) {
      const element: CaptionElement = {
        ...caption,
        id: caption.id ?? createElementId(),
        type: 'caption',
      }
      const track = mustGetTrack(next, finalTrackId)
      assertNoOverlap(track, element)
      next = replaceTrack(next, finalTrackId, (t) => ({
        ...t,
        elements: insertSorted(t.elements, element),
      }))
    }
    return next
  },
})

// ---------------------------------------------------------------------------
// Keyframe commands (Premiere stopwatch/diamond semantics)
// ---------------------------------------------------------------------------

function mustSupportProperty(element: TimelineElement, property: AnimatableProperty): void {
  if (!elementSupportsProperty(element, property)) {
    throw new CommandError(
      'invalid-payload',
      `"${element.type}" elements have no animatable "${property}" ` +
        `(supported: ${animatableProperties(element).join(', ') || 'none'})`,
    )
  }
}

function withKeyframes(
  project: Project,
  elementId: ElementId,
  property: AnimatableProperty,
  update: (track: Keyframe[]) => Keyframe[],
): Project {
  const { track, element } = mustLocate(project, elementId)
  mustSupportProperty(element, property)
  const keyframes = { ...(('keyframes' in element ? element.keyframes : undefined) ?? {}) }
  const nextTrack = update(keyframes[property] ?? [])
  if (nextTrack.length === 0) delete keyframes[property]
  else keyframes[property] = nextTrack
  const nextElement: TimelineElement = { ...element }
  if (Object.keys(keyframes).length === 0) delete nextElement.keyframes
  else nextElement.keyframes = keyframes
  return replaceTrack(project, track.id, (t) => ({
    ...t,
    elements: t.elements.map((e) => (e.id === element.id ? nextElement : e)),
  }))
}

defineCommand({
  type: 'setKeyframe',
  description:
    'Add or update a keyframe on a fixed-effect property (position.x/y, scale.x/y, ' +
    'rotation, opacity, blur, volume). The first keyframe arms the property (stopwatch on): ' +
    'an armed property is driven entirely by its keyframes. `timeMs` is element-local ' +
    '(0 = clip start). `easing` shapes the curve TOWARD the next keyframe.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    timeMs: z.number().int().nonnegative(),
    value: z.number(),
    easing: easingSchema.optional(),
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) =>
      upsertKeyframe(track, {
        timeMs: payload.timeMs,
        value: payload.value,
        ...(payload.easing !== undefined ? { easing: payload.easing } : {}),
      }),
    ),
})

defineCommand({
  type: 'removeKeyframe',
  description: 'Remove the keyframe at an exact element-local time. Removing the last one disarms the property.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    timeMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) => {
      if (!track.some((k) => k.timeMs === payload.timeMs)) {
        throw new CommandError(
          'unknown-keyframe',
          `no "${payload.property}" keyframe at ${payload.timeMs}ms`,
        )
      }
      return track.filter((k) => k.timeMs !== payload.timeMs)
    }),
})

defineCommand({
  type: 'moveKeyframe',
  description: 'Retime a keyframe (drag a diamond), preserving its value and easing.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    fromTimeMs: z.number().int().nonnegative(),
    toTimeMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) => {
      const keyframe = track.find((k) => k.timeMs === payload.fromTimeMs)
      if (!keyframe) {
        throw new CommandError(
          'unknown-keyframe',
          `no "${payload.property}" keyframe at ${payload.fromTimeMs}ms`,
        )
      }
      if (payload.toTimeMs !== payload.fromTimeMs && track.some((k) => k.timeMs === payload.toTimeMs)) {
        throw new CommandError(
          'duplicate-keyframe',
          `a "${payload.property}" keyframe already exists at ${payload.toTimeMs}ms`,
        )
      }
      return upsertKeyframe(
        track.filter((k) => k.timeMs !== payload.fromTimeMs),
        { ...keyframe, timeMs: payload.toTimeMs },
      )
    }),
})

defineCommand({
  type: 'setKeyframeEasing',
  description:
    'Set temporal interpolation toward the next keyframe: linear, hold, easeIn, easeOut, ' +
    'easeInOut, or { cubicBezier: [x1, y1, x2, y2] }.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    timeMs: z.number().int().nonnegative(),
    easing: easingSchema,
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) => {
      const keyframe = track.find((k) => k.timeMs === payload.timeMs)
      if (!keyframe) {
        throw new CommandError(
          'unknown-keyframe',
          `no "${payload.property}" keyframe at ${payload.timeMs}ms`,
        )
      }
      return track.map((k) => (k === keyframe ? { ...k, easing: payload.easing } : k))
    }),
})

defineCommand({
  type: 'clearKeyframes',
  description:
    'Remove all keyframes for one property (stopwatch off) or for the whole element. ' +
    'The static value takes over again.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (!('keyframes' in element) || !element.keyframes) return project
    const nextElement: TimelineElement = { ...element }
    if (payload.property) {
      const keyframes = { ...element.keyframes }
      delete keyframes[payload.property]
      if (Object.keys(keyframes).length === 0) delete nextElement.keyframes
      else nextElement.keyframes = keyframes
    } else {
      delete nextElement.keyframes
    }
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? nextElement : e)),
    }))
  },
})

defineCommand({
  type: 'applyAnimationPreset',
  description:
    'Apply an animation preset that EXPANDS into editable keyframes, built on ' +
    'pro easing curves (expo/quint settles, soft overshoot, M3 exits). ' +
    'In: fade-in, slide-in, pop-in, scale-in, zoom-in, whip-in, blur-in. ' +
    'Out: fade-out, slide-out, pop-out, zoom-out, whip-out, blur-out. ' +
    'Emphasis (whole clip): ken-burns, punch-zoom, pulse, breathe, float, sway, shake. ' +
    'Fast presets (whip-in/out, punch-zoom) also enable per-element motion blur.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    preset: animationPresetSchema,
    options: animationPresetOptionsSchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const expanded = expandAnimationPreset(element, payload.preset, payload.options)
    for (const property of Object.keys(expanded) as AnimatableProperty[]) {
      mustSupportProperty(element, property)
    }
    const nextElement: TimelineElement = { ...element, keyframes: expanded }
    // Whips and punches read as motion blur; switch it on unless the user
    // already made a motion-blur choice for this element.
    if (
      MOTION_BLUR_PRESETS.has(payload.preset) &&
      (nextElement.type === 'video' || nextElement.type === 'image' || nextElement.type === 'text') &&
      nextElement.motionBlur === undefined
    ) {
      nextElement.motionBlur = { enabled: true, shutterAngle: 180 }
    }
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? nextElement : e)),
    }))
  },
})

type VisualElement = TimelineElement & { type: 'video' | 'image' | 'text' | 'multicam' }

function mustBeVisual(element: TimelineElement): asserts element is VisualElement {
  if (
    element.type !== 'video' &&
    element.type !== 'image' &&
    element.type !== 'text' &&
    element.type !== 'multicam'
  ) {
    throw new CommandError(
      'invalid-payload',
      `"${element.type}" elements have no effects/blending/transitions`,
    )
  }
}

function withVisualElement(
  project: Project,
  elementId: ElementId,
  update: (element: VisualElement) => TimelineElement,
): Project {
  const { track, element } = mustLocate(project, elementId)
  mustBeVisual(element)
  const next = update(element)
  return replaceTrack(project, track.id, (t) => ({
    ...t,
    elements: t.elements.map((e) => (e.id === element.id ? next : e)),
  }))
}

function mustGetEffects(element: VisualElement, index: number): Effect[] {
  const effects = element.effects ?? []
  if (index < 0 || index >= effects.length) {
    throw new CommandError('unknown-effect', `element "${element.id}" has no effect at index ${index}`)
  }
  return [...effects]
}

defineCommand({
  type: 'addEffect',
  description:
    'Append a visual effect to an element\'s effect stack (or insert at `index`). ' +
    'Effects compile to a canvas filter and apply in stack order. Types: blur, ' +
    'brightness, contrast, saturate, grayscale, sepia, hue-rotate, invert, ' +
    'drop-shadow, css (raw CSS filter escape hatch).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    effect: effectSchema,
    index: z.number().int().nonnegative().optional(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = [...(element.effects ?? [])]
      const index = Math.min(payload.index ?? effects.length, effects.length)
      effects.splice(index, 0, payload.effect)
      return { ...element, effects }
    }),
})

defineCommand({
  type: 'updateEffect',
  description:
    'Patch the parameters of the effect at `index` in an element\'s stack ' +
    '(e.g. { radius: 12 } or { enabled: false }). The effect\'s `type` cannot change.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    index: z.number().int().nonnegative(),
    patch: z.record(z.string(), z.unknown()),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = mustGetEffects(element, payload.index)
      if ('type' in payload.patch && payload.patch.type !== effects[payload.index]!.type) {
        throw new CommandError('invalid-payload', 'patch may not change the effect "type"')
      }
      const merged = effectSchema.safeParse({ ...effects[payload.index], ...payload.patch })
      if (!merged.success) {
        throw new CommandError(
          'invalid-payload',
          `patch produces an invalid effect: ${merged.error.message}`,
          { cause: merged.error },
        )
      }
      effects[payload.index] = merged.data
      return { ...element, effects }
    }),
})

defineCommand({
  type: 'removeEffect',
  description: 'Remove the effect at `index` from an element\'s effect stack.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    index: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = mustGetEffects(element, payload.index)
      effects.splice(payload.index, 1)
      const next: VisualElement = { ...element }
      if (effects.length === 0) delete next.effects
      else next.effects = effects
      return next
    }),
})

defineCommand({
  type: 'reorderEffect',
  description: 'Move an effect within an element\'s stack (stack order = apply order).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    fromIndex: z.number().int().nonnegative(),
    toIndex: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const effects = mustGetEffects(element, payload.fromIndex)
      const toIndex = Math.min(payload.toIndex, effects.length - 1)
      const [effect] = effects.splice(payload.fromIndex, 1)
      effects.splice(toIndex, 0, effect!)
      return { ...element, effects }
    }),
})

defineCommand({
  type: 'setBlendMode',
  description:
    'Set how a visual element composites against the layers below ' +
    '(multiply, screen, overlay, ...). Pass null for normal.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    blendMode: blendModeSchema.nullable(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.blendMode === null || payload.blendMode === 'normal') delete next.blendMode
      else next.blendMode = payload.blendMode
      return next
    }),
})

defineCommand({
  type: 'setMotionBlur',
  description:
    'Set per-element motion blur (After Effects layer model: sub-frame ' +
    'transform samples accumulated across a shutter window). Only KEYFRAMED ' +
    'position/scale/rotation motion blurs. shutterAngle 360 = full frame ' +
    'interval; 180 = film look (default). Pass null to turn it off.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    motionBlur: motionBlurSchema.nullable(),
  }),
  reduce: (project, payload) =>
    withVisualElement(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.motionBlur === null) delete next.motionBlur
      else next.motionBlur = payload.motionBlur
      return next
    }),
})

defineCommand({
  type: 'setTransition',
  description:
    'Set (or clear with null) the transition from an element into the NEXT ' +
    'exactly-adjacent clip on the same track. Types: dissolve, fade-black, ' +
    'fade-white, slide-left, slide-right, wipe-left, wipe-right. The blend ' +
    'window is centered on the cut and never longer than either clip; where ' +
    'a clip has no media handles the renderer freezes its boundary frame.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    transition: transitionSchema.nullable(),
  }),
  reduce: (project, payload) => {
    const { track } = mustLocate(project, payload.elementId)
    return withVisualElement(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.transition === null) {
        delete next.transition
        return next
      }
      next.transition = payload.transition
      const pair = getTransitionPair(track, next)
      if (!pair) {
        throw new CommandError(
          'invalid-payload',
          `element "${element.id}" has no exactly-adjacent next clip on its track ` +
            '(transitions require a butt cut)',
        )
      }
      // OTIO offset constraint, stored: the window may not exceed either
      // adjacent clip. getTransitionPair already computes the clamped window.
      if (pair.durationMs < 100) {
        throw new CommandError(
          'out-of-bounds',
          `clips at this cut are too short for a transition (max window ${pair.durationMs}ms)`,
        )
      }
      next.transition = { ...payload.transition, durationMs: pair.durationMs }
      return next
    })
  },
})

function mustBeTimeMappable(element: TimelineElement): asserts element is TimelineElement & {
  type: 'video' | 'audio'
} {
  if (element.type !== 'video' && element.type !== 'audio') {
    throw new CommandError('invalid-payload', `"${element.type}" elements have no playback speed`)
  }
}

defineCommand({
  type: 'setElementSpeed',
  description:
    'Set a constant playback speed on a video/audio element (2 = twice as fast). ' +
    'The clip keeps its in-point; its timeline duration rescales to play the same ' +
    'source span. Replaces any existing speed ramp with a constant map; speed 1 ' +
    'removes the map. For ramps and freeze-frames use setTimeMap.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    speed: z.number().min(0.05).max(20),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    mustBeTimeMappable(element)
    const sourceSpanMs = getSourceSpanMs(element)
    const durationMs = Math.max(MIN_ELEMENT_DURATION_MS, Math.round(sourceSpanMs / payload.speed))
    const next: TimelineElement = { ...element, durationMs }
    if (Math.abs(payload.speed - 1) < 1e-9) delete next.timeMap
    else next.timeMap = makeConstantSpeedMap(durationMs, sourceSpanMs / durationMs)
    validateElement(project, next)
    assertNoOverlap(track, next, element.id)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: insertPlaced(t, next),
    }))
  },
})

defineCommand({
  type: 'setTimeMap',
  description:
    'Set or clear a time remap curve on a video/audio element: keyframes from ' +
    'element-local output ms to source ms (relative to trimStartMs), monotone ' +
    'non-decreasing. Bezier easing between keyframes = speed ramp; a flat ' +
    'segment = freeze-frame. Pass null to restore 1x.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    timeMap: timeMapSchema.nullable(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    mustBeTimeMappable(element)
    const next: TimelineElement = { ...element }
    if (payload.timeMap === null) delete next.timeMap
    else next.timeMap = payload.timeMap
    validateElement(project, next)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? next : e)),
    }))
  },
})

// ---------------------------------------------------------------------------
// Trim-suite edits (slip / roll / slide / ripple-trim) — see edge-trim.ts
// ---------------------------------------------------------------------------

const sortByStart = (elements: TimelineElement[]): TimelineElement[] =>
  [...elements].sort((a, b) => a.startMs - b.startMs)

/** Pairwise overlap check after multi-element edits (skips magnetic tracks). */
function assertTrackHasNoOverlaps(track: Track): void {
  if (track.magnetic) return
  for (let i = 1; i < track.elements.length; i++) {
    const previous = track.elements[i - 1]!
    const current = track.elements[i]!
    if (previous.startMs + previous.durationMs > current.startMs) {
      throw new CommandError(
        'overlap',
        `edit would overlap "${previous.id}" and "${current.id}" on track "${track.id}"`,
      )
    }
  }
}

/** The exactly-adjacent clip after `element` on its track, if any. */
function adjacentNext(track: Track, element: TimelineElement): TimelineElement | undefined {
  const cutMs = element.startMs + element.durationMs
  return track.elements.find((e) => e.startMs === cutMs && e.id !== element.id)
}

/** The exactly-adjacent clip before `element` on its track, if any. */
function adjacentPrevious(track: Track, element: TimelineElement): TimelineElement | undefined {
  return track.elements.find(
    (e) => e.startMs + e.durationMs === element.startMs && e.id !== element.id,
  )
}

defineCommand({
  type: 'trimEdge',
  description:
    'Trim ONE edge of a clip while its content stays anchored: reversed ' +
    'spans, speed maps, keyframes, and caption words all keep showing the ' +
    'same frames. Positive deltaMs moves the edge later. The other edge and ' +
    'every other clip stay put. Prefer this over raw trimElement for edge ' +
    "drags — trimElement edits the source window directly and shifts a " +
    "reversed clip's content.",
  payloadSchema: z.object({
    elementId: elementIdSchema,
    edge: z.enum(['start', 'end']),
    deltaMs: z.number().int(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (payload.deltaMs === 0) return project
    const next = applyEdgeTrim(element, payload.edge, payload.deltaMs)
    validateElement(project, next)
    assertNoOverlap(track, next, element.id)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: insertPlaced(t, next),
    }))
  },
})

defineCommand({
  type: 'slipElement',
  description:
    'Slip a clip: shift WHICH part of the source plays without moving the clip ' +
    'on the timeline. Positive deltaMs slides the source window later. Applies ' +
    'to video/audio (trim offset) and multicam (every source in sync).',
  payloadSchema: z.object({ elementId: elementIdSchema, deltaMs: z.number().int() }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (payload.deltaMs === 0) return project
    let next: TimelineElement
    if (element.type === 'video' || element.type === 'audio') {
      const trimStartMs = element.trimStartMs + payload.deltaMs
      if (trimStartMs < 0) {
        throw new CommandError('out-of-bounds', `"${element.id}" has no media before its trim start`)
      }
      next = { ...element, trimStartMs }
    } else if (element.type === 'multicam') {
      next = {
        ...element,
        sources: element.sources.map((source) => {
          const trimStartMs = source.trimStartMs + payload.deltaMs
          if (trimStartMs < 0) {
            throw new CommandError(
              'out-of-bounds',
              `multicam source "${source.key}" has no media before its trim start`,
            )
          }
          return { ...source, trimStartMs }
        }),
      }
    } else {
      throw new CommandError('invalid-payload', `"${element.type}" elements have no source to slip`)
    }
    validateElement(project, next)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? next : e)),
    }))
  },
})

defineCommand({
  type: 'rollEdit',
  description:
    'Roll the cut between a clip and its exactly-adjacent NEXT clip: the ' +
    'boundary moves by deltaMs, one clip revealing source while the other ' +
    'conceals it. Track length and every other clip stay put.',
  payloadSchema: z.object({ elementId: elementIdSchema, deltaMs: z.number().int() }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const right = adjacentNext(track, element)
    if (!right) {
      throw new CommandError(
        'invalid-payload',
        `element "${element.id}" has no exactly-adjacent next clip to roll against`,
      )
    }
    if (payload.deltaMs === 0) return project
    const newLeft = applyEdgeTrim(element, 'end', payload.deltaMs)
    const newRight = applyEdgeTrim(right, 'start', payload.deltaMs)
    validateElement(project, newLeft)
    validateElement(project, newRight)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: sortByStart(
        t.elements.map((e) => (e.id === element.id ? newLeft : e.id === right.id ? newRight : e)),
      ),
    }))
  },
})

defineCommand({
  type: 'slideElement',
  description:
    'Slide a clip along its exactly-adjacent neighbors: the clip moves by ' +
    'deltaMs keeping its content; the left neighbor\'s end and the right ' +
    'neighbor\'s start absorb the change. Use moveElement across gaps.',
  payloadSchema: z.object({ elementId: elementIdSchema, deltaMs: z.number().int() }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const left = adjacentPrevious(track, element)
    const right = adjacentNext(track, element)
    if (!left || !right) {
      throw new CommandError(
        'invalid-payload',
        `slide requires exactly-adjacent clips on both sides of "${element.id}"`,
      )
    }
    if (payload.deltaMs === 0) return project
    const newLeft = applyEdgeTrim(left, 'end', payload.deltaMs)
    const newRight = applyEdgeTrim(right, 'start', payload.deltaMs)
    const moved: TimelineElement = { ...element, startMs: element.startMs + payload.deltaMs }
    validateElement(project, newLeft)
    validateElement(project, newRight)
    validateElement(project, moved)
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: sortByStart(
        t.elements.map((e) =>
          e.id === left.id ? newLeft : e.id === right.id ? newRight : e.id === element.id ? moved : e,
        ),
      ),
    }))
  },
})

defineCommand({
  type: 'rippleTrim',
  description:
    'Trim a clip edge AND ripple: everything downstream of the edit shifts by ' +
    'the same amount, so no gap opens or closes unevenly. scope "timeline" ' +
    '(default) shifts every unlocked track; "track" only the clip\'s own track.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    edge: z.enum(['start', 'end']),
    deltaMs: z.number().int(),
    scope: z.enum(['track', 'timeline']).default('timeline'),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (payload.deltaMs === 0) return project
    // A start trim keeps the clip's position: the edge change is absorbed by
    // rippling downstream instead, so lift the clip clear of the timeline-zero
    // check and pin its start back afterwards.
    const lifted =
      payload.edge === 'start'
        ? { ...element, startMs: element.startMs + Math.max(0, -payload.deltaMs) }
        : element
    const trimmedRaw = applyEdgeTrim(lifted, payload.edge, payload.deltaMs)
    const trimmed =
      payload.edge === 'start' ? { ...trimmedRaw, startMs: element.startMs } : trimmedRaw
    const shiftMs = payload.edge === 'end' ? payload.deltaMs : -payload.deltaMs
    const boundaryMs =
      payload.edge === 'end' ? element.startMs + element.durationMs : element.startMs
    validateElement(project, trimmed)

    const tracks = project.tracks.map((t) => {
      const affected = t.id === track.id || (payload.scope === 'timeline' && !t.locked)
      if (!affected) return t
      const elements = sortByStart(
        t.elements.map((e) => {
          if (e.id === element.id) return trimmed
          if (e.startMs < boundaryMs) return e
          const startMs = e.startMs + shiftMs
          if (startMs < 0) {
            throw new CommandError(
              'out-of-bounds',
              `ripple would move "${e.id}" before the start of the timeline`,
            )
          }
          return { ...e, startMs }
        }),
      )
      const next = { ...t, elements }
      assertTrackHasNoOverlaps(next)
      return next
    })
    return compactTimelineIfMagnetic({ ...project, tracks })
  },
})

// ---------------------------------------------------------------------------
// Multicam (layouts + angle switching) — see multicam.ts / layouts.ts
// ---------------------------------------------------------------------------

function mustBeMulticam(element: TimelineElement): asserts element is TimelineElement & {
  type: 'multicam'
} {
  if (element.type !== 'multicam') {
    throw new CommandError('invalid-payload', `"${element.type}" elements have no angles/sources`)
  }
}

function withMulticam(
  project: Project,
  elementId: ElementId,
  update: (element: TimelineElement & { type: 'multicam' }) => TimelineElement,
): Project {
  const { track, element } = mustLocate(project, elementId)
  mustBeMulticam(element)
  const next = update(element)
  return replaceTrack(project, track.id, (t) => ({
    ...t,
    elements: t.elements.map((e) => (e.id === element.id ? next : e)),
  }))
}

function mustGetLayout(project: Project, layoutId: string) {
  const layout = project.layouts.find((l) => l.id === layoutId)
  if (!layout) throw new CommandError('unknown-layout', `no layout "${layoutId}"`)
  return layout
}

defineCommand({
  type: 'saveLayout',
  description:
    'Add or replace a multicam layout in the project (slots position sources ' +
    'on the canvas in normalized 0..1 rects; first slot paints bottom).',
  payloadSchema: z.object({ layout: layoutSchema }),
  reduce: (project, payload) => {
    const exists = project.layouts.some((l) => l.id === payload.layout.id)
    return {
      ...project,
      layouts: exists
        ? project.layouts.map((l) => (l.id === payload.layout.id ? payload.layout : l))
        : [...project.layouts, payload.layout],
    }
  },
})

defineCommand({
  type: 'removeLayout',
  description: 'Remove a project layout. Fails while any multicam cut still uses it.',
  payloadSchema: z.object({ layoutId: z.string().min(1) }),
  reduce: (project, payload) => {
    mustGetLayout(project, payload.layoutId)
    const inUse = project.tracks.some((track) =>
      track.elements.some(
        (e) => e.type === 'multicam' && e.angles.some((a) => a.layoutId === payload.layoutId),
      ),
    )
    if (inUse) {
      throw new CommandError('layout-in-use', `layout "${payload.layoutId}" is used by a multicam cut`)
    }
    return { ...project, layouts: project.layouts.filter((l) => l.id !== payload.layoutId) }
  },
})

defineCommand({
  type: 'savePreset',
  description:
    'Add or replace a property preset: a named bundle of inspector values ' +
    '(an effects stack, a text style, a layout-slot style, …). The preset ' +
    'kind names the surface that captures and applies it.',
  payloadSchema: z.object({ preset: propertyPresetSchema }),
  reduce: (project, payload) => {
    const exists = project.presets.some((p) => p.id === payload.preset.id)
    return {
      ...project,
      presets: exists
        ? project.presets.map((p) => (p.id === payload.preset.id ? payload.preset : p))
        : [...project.presets, payload.preset],
    }
  },
})

defineCommand({
  type: 'removePreset',
  description: 'Remove a property preset from the project.',
  payloadSchema: z.object({ presetId: z.string().min(1) }),
  reduce: (project, payload) => {
    if (!project.presets.some((p) => p.id === payload.presetId)) {
      throw new CommandError('unknown-preset', `no preset "${payload.presetId}"`)
    }
    return { ...project, presets: project.presets.filter((p) => p.id !== payload.presetId) }
  },
})

defineCommand({
  type: 'createMulticam',
  description:
    'Combine 1+ video elements into one multicam clip: sources are synced by ' +
    'their current timeline alignment, originals are removed, and the project ' +
    'is seeded with default talking-head layouts (screen + camera) when it has ' +
    'none. Source keys: with two sources the bottom layer becomes "screen" and ' +
    'the top layer "camera" (roles can be reassigned afterwards); audio follows ' +
    'the camera.',
  payloadSchema: z.object({
    elementIds: z.array(elementIdSchema).min(1),
    /** Id for the new multicam element; generated when omitted. */
    multicamId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const located = payload.elementIds.map((id) => mustLocate(project, id))
    const videos = located.map(({ element }) => {
      if (element.type !== 'video') {
        throw new CommandError('invalid-payload', `"${element.id}" is not a video element`)
      }
      return element
    })

    const startMs = Math.min(...videos.map((v) => v.startMs))
    const endMs = Math.max(...videos.map((v) => v.startMs + v.durationMs))

    // Role keys: bottom layer = screen, top layer = camera (the user can
    // reassign roles afterwards via the multicam source-role controls).
    let keys: string[]
    if (videos.length === 2) {
      const screen = located[0]!.trackIndex <= located[1]!.trackIndex ? 0 : 1
      keys = videos.map((_, i) => (i === screen ? 'screen' : 'camera'))
    } else if (videos.length === 1) {
      keys = ['camera']
    } else {
      keys = videos.map((_, i) => `cam-${i + 1}`)
    }

    let next = project
    if (next.layouts.length === 0) {
      next = { ...next, layouts: createDefaultLayouts() }
    }

    const sources = videos.map((video, i) => ({
      key: keys[i]!,
      assetId: video.assetId,
      // Align: at multicam-local 0 every source plays what it was playing at
      // the earliest selected clip's start (negative clamps to 0 = freeze-in).
      trimStartMs: Math.max(0, video.trimStartMs - (video.startMs - startMs)),
    }))

    const audioKey = keys.includes('camera') ? 'camera' : keys[0]!
    const element: TimelineElement = {
      id: payload.multicamId ?? createElementId(),
      type: 'multicam',
      startMs,
      durationMs: endMs - startMs,
      sources,
      angles: [{ atMs: 0, layoutId: next.layouts[0]!.id }],
      audioSource: audioKey,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      volume: 1,
      muted: false,
    }

    // Remove the originals, then place the multicam on the first one's track.
    const ids = new Set(payload.elementIds)
    next = {
      ...next,
      tracks: next.tracks.map((t) => ({ ...t, elements: t.elements.filter((e) => !ids.has(e.id)) })),
    }
    const targetTrack = mustGetTrack(next, located[0]!.track.id)
    assertNoOverlap(targetTrack, element)
    return replaceTrack(next, targetTrack.id, (t) => ({
      ...t,
      elements: insertPlaced(t, element),
    }))
  },
})

defineCommand({
  type: 'addAngleCut',
  description:
    'Cut a multicam to a layout at an element-local time: the layout is ' +
    'active from `atMs` until the next cut (the live-switching primitive — ' +
    'press a layout key while playing).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().nonnegative(),
    layoutId: z.string().min(1),
  }),
  reduce: (project, payload) => {
    mustGetLayout(project, payload.layoutId)
    return withMulticam(project, payload.elementId, (element) => {
      const angles = element.angles
        .filter((a) => a.atMs !== payload.atMs)
        .concat({ atMs: payload.atMs, layoutId: payload.layoutId })
        .sort((a, b) => a.atMs - b.atMs)
      return { ...element, angles }
    })
  },
})

defineCommand({
  type: 'moveAngleCut',
  description: 'Retime a multicam cut (drag its tick). Clamped between its neighbors.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    fromMs: z.number().int().nonnegative(),
    toMs: z.number().int().positive(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      const index = element.angles.findIndex((a) => a.atMs === payload.fromMs)
      if (index === -1) {
        throw new CommandError('unknown-cut', `no cut at ${payload.fromMs}ms`)
      }
      if (index === 0) {
        throw new CommandError('invalid-payload', 'the first cut is pinned to 0')
      }
      const previous = element.angles[index - 1]!
      const next = element.angles[index + 1]
      const toMs = Math.max(
        previous.atMs + 1,
        Math.min(payload.toMs, next ? next.atMs - 1 : element.durationMs - 1),
      )
      const angles = element.angles.map((a, i) => (i === index ? { ...a, atMs: toMs } : a))
      return { ...element, angles }
    }),
})

defineCommand({
  type: 'removeAngleCut',
  description: 'Remove a multicam cut; the previous layout extends over its span.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().positive(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (!element.angles.some((a) => a.atMs === payload.atMs)) {
        throw new CommandError('unknown-cut', `no cut at ${payload.atMs}ms`)
      }
      return { ...element, angles: element.angles.filter((a) => a.atMs !== payload.atMs) }
    }),
})

defineCommand({
  type: 'setAngleLayout',
  description:
    'Change which layout a multicam span uses without cutting (the paused ' +
    '"correct this take" action; `atMs` is the span\'s cut time).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    atMs: z.number().int().nonnegative(),
    layoutId: z.string().min(1),
  }),
  reduce: (project, payload) => {
    mustGetLayout(project, payload.layoutId)
    return withMulticam(project, payload.elementId, (element) => {
      const index = element.angles.findIndex((a) => a.atMs === payload.atMs)
      if (index === -1) {
        throw new CommandError('unknown-cut', `no cut at ${payload.atMs}ms`)
      }
      const angles = element.angles.map((a, i) =>
        i === index ? { ...a, layoutId: payload.layoutId } : a,
      )
      return { ...element, angles }
    })
  },
})

defineCommand({
  type: 'setMulticamAudio',
  description: 'Choose which multicam source supplies the audio (null mutes all sources).',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    sourceKey: z.string().min(1).nullable(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (payload.sourceKey !== null && !element.sources.some((s) => s.key === payload.sourceKey)) {
        throw new CommandError('unknown-source', `no multicam source "${payload.sourceKey}"`)
      }
      const next = { ...element }
      if (payload.sourceKey === null) delete next.audioSource
      else next.audioSource = payload.sourceKey
      return next
    }),
})

defineCommand({
  type: 'setMulticamSourceTrim',
  description:
    "Nudge one multicam source's sync: its media time at the multicam's start (ms).",
  payloadSchema: z.object({
    elementId: elementIdSchema,
    sourceKey: z.string().min(1),
    trimStartMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (!element.sources.some((s) => s.key === payload.sourceKey)) {
        throw new CommandError('unknown-source', `no multicam source "${payload.sourceKey}"`)
      }
      return {
        ...element,
        sources: element.sources.map((s) =>
          s.key === payload.sourceKey ? { ...s, trimStartMs: payload.trimStartMs } : s,
        ),
      }
    }),
})

defineCommand({
  type: 'setMulticamAngleTransition',
  description:
    'Standardize the cut style of a multicam: one transition blended at ' +
    'EVERY angle cut (null = hard jump cuts). Same vocabulary as clip ' +
    'transitions (dissolve, fade-black, …); each window is centered on its ' +
    'cut and clamped so neighboring windows never overlap.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    transition: transitionSchema.nullable(),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      const next = { ...element }
      if (payload.transition === null) delete next.angleTransition
      else next.angleTransition = payload.transition
      return next
    }),
})

defineCommand({
  type: 'setMulticamSourceKey',
  description:
    "Reassign a multicam source's role key ('screen', 'camera', …) — the key " +
    'layout slots match on. If another source already holds `newKey` the two ' +
    'swap keys (audio stays with its role); on a plain rename the audio ' +
    'source follows the renamed key.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    sourceKey: z.string().min(1),
    newKey: z.string().min(1),
  }),
  reduce: (project, payload) =>
    withMulticam(project, payload.elementId, (element) => {
      if (!element.sources.some((s) => s.key === payload.sourceKey)) {
        throw new CommandError('unknown-source', `no multicam source "${payload.sourceKey}"`)
      }
      if (payload.newKey === payload.sourceKey) return element
      const taken = element.sources.some((s) => s.key === payload.newKey)
      const sources = element.sources.map((s) =>
        s.key === payload.sourceKey
          ? { ...s, key: payload.newKey }
          : taken && s.key === payload.newKey
            ? { ...s, key: payload.sourceKey }
            : s,
      )
      const next = { ...element, sources }
      // Swap keeps both keys alive, so audio stays with its role (fixing a
      // wrong screen/camera guess should move the audio to the real camera).
      if (!taken && element.audioSource === payload.sourceKey) {
        next.audioSource = payload.newKey
      }
      return next
    }),
})

defineCommand({
  type: 'flattenMulticam',
  description:
    'Explode a multicam into plain clips: one video element per cut-span slot ' +
    '(on new tracks, layout geometry baked into transforms — approximate, no ' +
    'crop primitive) plus one audio element from the audio source. One-way; ' +
    'undo restores the multicam.',
  payloadSchema: z.object({ elementId: elementIdSchema }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    mustBeMulticam(element)
    if (element.timeMap) {
      throw new CommandError(
        'invalid-payload',
        'flatten before changing speed (set speed 1, flatten, then re-apply)',
      )
    }

    const maxSlots = Math.max(
      1,
      ...element.angles.map((a) => mustGetLayout(project, a.layoutId).slots.length),
    )

    // Spans: each cut until the next (or the element end).
    const spans = element.angles.map((cut, i) => ({
      cut,
      fromMs: cut.atMs,
      toMs: element.angles[i + 1]?.atMs ?? element.durationMs,
    }))

    const W = (assetId: AssetId) => project.assets[assetId]?.width ?? project.width
    const H = (assetId: AssetId) => project.assets[assetId]?.height ?? project.height

    const slotTracks: Track[] = Array.from({ length: maxSlots }, (_, i) => ({
      id: createTrackId(),
      name: `Multicam ${i + 1}`,
      muted: false,
      hidden: false,
      locked: false,
      magnetic: false,
      elements: [],
    }))

    for (const span of spans) {
      if (span.toMs - span.fromMs < MIN_ELEMENT_DURATION_MS) continue
      const layout = mustGetLayout(project, span.cut.layoutId)
      layout.slots.forEach((slot, slotIndex) => {
        const source = element.sources.find((s) => s.key === slot.source)
        if (!source) return
        const rw = slot.rect.w * project.width
        const rh = slot.rect.h * project.height
        const aw = W(source.assetId)
        const ah = H(source.assetId)
        const scale =
          slot.fit === 'cover' ? Math.max(rw / aw, rh / ah) : Math.min(rw / aw, rh / ah)
        slotTracks[slotIndex]!.elements.push({
          id: createElementId(),
          type: 'video',
          startMs: element.startMs + span.fromMs,
          durationMs: span.toMs - span.fromMs,
          assetId: source.assetId,
          trimStartMs: source.trimStartMs + span.fromMs,
          transform: {
            x: (slot.rect.x + slot.rect.w / 2 - 0.5) * project.width,
            y: (slot.rect.y + slot.rect.h / 2 - 0.5) * project.height,
            scaleX: scale,
            scaleY: scale,
            rotation: 0,
          },
          opacity: 1,
          volume: 1,
          muted: true,
        })
      })
    }

    const audioSource = element.sources.find((s) => s.key === element.audioSource)
    const audioTrack: Track | null = audioSource
      ? {
          id: createTrackId(),
          name: 'Multicam audio',
          muted: false,
          hidden: false,
          locked: false,
          magnetic: false,
          elements: [
            {
              id: createElementId(),
              type: 'audio',
              startMs: element.startMs,
              durationMs: element.durationMs,
              assetId: audioSource.assetId,
              trimStartMs: audioSource.trimStartMs,
              volume: element.volume,
              muted: element.muted,
            },
          ],
        }
      : null

    const trackIndex = project.tracks.findIndex((t) => t.id === track.id)
    const tracks = project.tracks.map((t) =>
      t.id === track.id
        ? { ...t, elements: t.elements.filter((e) => e.id !== element.id) }
        : t,
    )
    // Slot tracks go where the multicam was (bottom slot first); audio below.
    tracks.splice(trackIndex + 1, 0, ...slotTracks)
    if (audioTrack) tracks.splice(trackIndex, 0, audioTrack)
    return { ...project, tracks }
  },
})

defineCommand({
  type: 'detachAudio',
  description:
    'Detach a video element\'s audio onto its own audio element. The video is ' +
    'muted, volume keyframes move to the new audio element, and both share a ' +
    '`linkId` so UIs can select/move them together. Creates a track for the ' +
    'audio when `toTrackId` is omitted.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    /** Track for the audio element; a new bottom track is created when omitted. */
    toTrackId: trackIdSchema.optional(),
    /** Id for the new audio element; generated when omitted. */
    audioElementId: elementIdSchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (element.type !== 'video') {
      throw new CommandError('invalid-payload', `"${element.type}" elements have no audio to detach`)
    }
    if (element.muted) {
      throw new CommandError('invalid-payload', `video "${element.id}" is muted; nothing to detach`)
    }
    const linkId = element.linkId ?? createLinkId()
    const volumeKeyframes = element.keyframes?.volume

    const audio: TimelineElement = {
      id: payload.audioElementId ?? createElementId(),
      type: 'audio',
      startMs: element.startMs,
      durationMs: element.durationMs,
      trimStartMs: element.trimStartMs,
      assetId: element.assetId,
      volume: element.volume,
      muted: false,
      linkId,
      ...(element.timeMap ? { timeMap: element.timeMap } : {}),
      ...(volumeKeyframes ? { keyframes: { volume: volumeKeyframes } } : {}),
    }
    if (getElementLocation(project, audio.id)) {
      throw new CommandError('duplicate-element', `element "${audio.id}" already exists`)
    }

    const video: TimelineElement = { ...element, muted: true, volume: 1, linkId }
    if (video.type === 'video' && video.keyframes?.volume) {
      const keyframes = { ...video.keyframes }
      delete keyframes.volume
      if (Object.keys(keyframes).length === 0) delete video.keyframes
      else video.keyframes = keyframes
    }

    let next = replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? video : e)),
    }))

    if (payload.toTrackId) {
      const target = mustGetTrack(next, payload.toTrackId)
      assertNoOverlap(target, audio)
      return replaceTrack(next, target.id, (t) => ({
        ...t,
        elements: insertPlaced(t, audio),
      }))
    }
    const audioTrack: Track = {
      id: createTrackId(),
      name: 'Audio',
      muted: false,
      hidden: false,
      locked: false,
      magnetic: next.tracks.some((track) => track.magnetic),
      elements: [audio],
    }
    // Bottom of the paint order: audio has no visuals to occlude.
    return { ...next, tracks: [audioTrack, ...next.tracks] }
  },
})

defineCommand({
  type: 'applyThumbnail',
  description:
    'Compose a cover over the first five frames: expands a thumbnail ' +
    "template's text items into elements on the topmost \"Thumbnail\" track " +
    '(created locked when missing, replaced when present). Unlike a metadata ' +
    'cover, this is baked into the exported video.',
  payloadSchema: z.object({ template: thumbnailTemplateSchema }),
  reduce: (project, payload) => {
    const elements = expandThumbnailTemplate(project, payload.template)
    const existing = findThumbnailTrack(project)
    if (existing) {
      return {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === existing.id
            ? { ...t, elements: [...t.elements.filter((e) => e.type === 'image'), ...elements] }
            : t,
        ),
      }
    }
    const track: Track = {
      id: createTrackId(),
      name: THUMBNAIL_TRACK_NAME,
      muted: false,
      hidden: false,
      locked: true,
      magnetic: false,
      elements,
    }
    return { ...project, tracks: [...project.tracks, track] }
  },
})

defineCommand({
  type: 'applyZoomPreset',
  description:
    'Apply a saved zoom (relative keyframe pattern: scale multipliers + ' +
    'position deltas) to an element at an element-local time. Expands into ' +
    'editable keyframes; existing keyframes inside the window are replaced. ' +
    'Override durationMs to retime the move.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    preset: zoomPresetSchema,
    atMs: z.number().int().nonnegative(),
    durationMs: z.number().int().min(100).optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    for (const property of Object.keys(payload.preset.tracks) as AnimatableProperty[]) {
      mustSupportProperty(element, property)
    }
    const keyframes = expandZoomPreset(element, payload.preset, payload.atMs, payload.durationMs)
    const next: TimelineElement = { ...element, keyframes }
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? next : e)),
    }))
  },
})

// ---------------------------------------------------------------------------
// Markers (project-level points on the time ruler)
// ---------------------------------------------------------------------------

function mustGetMarker(project: Project, markerId: MarkerId) {
  const marker = project.markers.find((m) => m.id === markerId)
  if (!marker) throw new CommandError('unknown-marker', `no marker "${markerId}"`)
  return marker
}

const sortMarkers = (markers: Project['markers']) =>
  [...markers].sort((a, b) => a.timeMs - b.timeMs)

defineCommand({
  type: 'addMarker',
  description: 'Add a timeline marker at an absolute time. Omit `id` to have one generated.',
  payloadSchema: z.object({
    id: markerIdSchema.optional(),
    timeMs: z.number().int().nonnegative(),
    label: z.string().optional(),
    color: z.string().optional(),
  }),
  reduce: (project, payload) => {
    const id = payload.id ?? createMarkerId()
    if (project.markers.some((m) => m.id === id)) {
      throw new CommandError('duplicate-marker', `marker "${id}" already exists`)
    }
    const marker = {
      id,
      timeMs: payload.timeMs,
      ...(payload.label !== undefined ? { label: payload.label } : {}),
      ...(payload.color !== undefined ? { color: payload.color } : {}),
    }
    return { ...project, markers: sortMarkers([...project.markers, marker]) }
  },
})

defineCommand({
  type: 'updateMarker',
  description: 'Retime, relabel, or recolor a timeline marker.',
  payloadSchema: z.object({
    markerId: markerIdSchema,
    timeMs: z.number().int().nonnegative().optional(),
    label: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  }),
  reduce: (project, payload) => {
    mustGetMarker(project, payload.markerId)
    const markers = project.markers.map((m) => {
      if (m.id !== payload.markerId) return m
      const next = { ...m, timeMs: payload.timeMs ?? m.timeMs }
      if (payload.label !== undefined) {
        if (payload.label === null) delete next.label
        else next.label = payload.label
      }
      if (payload.color !== undefined) {
        if (payload.color === null) delete next.color
        else next.color = payload.color
      }
      return next
    })
    return { ...project, markers: sortMarkers(markers) }
  },
})

defineCommand({
  type: 'removeMarker',
  description: 'Remove a timeline marker.',
  payloadSchema: z.object({ markerId: markerIdSchema }),
  reduce: (project, payload) => {
    mustGetMarker(project, payload.markerId)
    return { ...project, markers: project.markers.filter((m) => m.id !== payload.markerId) }
  },
})

defineCommand({
  type: 'rippleDelete',
  description:
    'Remove elements AND close the gaps they leave: later clips on the same ' +
    'track shift left by the removed duration (Premiere ripple delete). ' +
    'Other tracks are not affected.',
  payloadSchema: z.object({ elementIds: z.array(elementIdSchema).min(1) }),
  reduce: (project, payload) => {
    const ids = new Set<ElementId>(payload.elementIds)
    for (const id of payload.elementIds) mustLocate(project, id)
    const tracks = project.tracks.map((track) => {
      const removed = track.elements.filter((e) => ids.has(e.id))
      if (removed.length === 0) return track
      const elements = track.elements
        .filter((e) => !ids.has(e.id))
        .map((element) => {
          // Uniform left-shift by everything removed before this clip keeps
          // ordering and can never create overlaps.
          const shiftMs = removed
            .filter((r) => r.startMs < element.startMs)
            .reduce((sum, r) => sum + r.durationMs, 0)
          return shiftMs > 0 ? { ...element, startMs: element.startMs - shiftMs } : element
        })
      return { ...track, elements }
    })
    return compactTimelineIfMagnetic({ ...project, tracks })
  },
})
