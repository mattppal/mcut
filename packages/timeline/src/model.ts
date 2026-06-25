import { z } from 'zod'
import type { AssetId, ElementId, GroupId, MarkerId, TrackId } from './id'
import { createProjectId, createTrackId } from './id'
import {
  anyElementInputSchema,
  anyElementSchema,
  getElementType,
  registerElementTypeEntry,
  type ElementTypeEntry,
} from './element-registry'
import { CommandError } from './errors'
import { keyframesSchema } from './keyframes'
import { migrateProject, PROJECT_VERSION } from './migrations'
import {
  getAverageSpeed,
  getSourceSpanMs,
  getSourceTimeMs,
  splitTimeMap,
  timeMapSchema,
} from './speed'
import { blendModeSchema, effectsSchema, motionBlurSchema } from './effects'
import { getLayout, layoutSchema } from './layouts'
import { propertyPresetSchema } from './presets'
import { cropSchema, shadowSchema, strokeSchema } from './style'
import { textRunSchema } from './rich-text'
import { getActiveLayout, getAngleTransitionAt, getMulticamSourceTimeMs, splitAngles } from './multicam'
import { transitionSchema } from './transitions'

/** Minimum element duration the engine will accept. */
export const MIN_ELEMENT_DURATION_MS = 10

// The .meta() JSON Schema annotations keep z.custom representable in
// listToolDefinitions() output; they do not affect validation.
const trackIdSchema = z
  .custom<TrackId>(
    (v) => typeof v === 'string' && /^t-[\w-]+$/.test(v),
    'invalid track id (expected "t-..." prefix)',
  )
  .meta({ type: 'string', pattern: '^t-[\\w-]+$' })
const elementIdSchema = z
  .custom<ElementId>(
    (v) => typeof v === 'string' && /^e-[\w-]+$/.test(v),
    'invalid element id (expected "e-..." prefix)',
  )
  .meta({ type: 'string', pattern: '^e-[\\w-]+$' })
const assetIdSchema = z
  .custom<AssetId>(
    (v) => typeof v === 'string' && /^a-[\w-]+$/.test(v),
    'invalid asset id (expected "a-..." prefix)',
  )
  .meta({ type: 'string', pattern: '^a-[\\w-]+$' })
const markerIdSchema = z
  .custom<MarkerId>(
    (v) => typeof v === 'string' && /^m-[\w-]+$/.test(v),
    'invalid marker id (expected "m-..." prefix)',
  )
  .meta({ type: 'string', pattern: '^m-[\\w-]+$' })
const groupIdSchema = z
  .custom<GroupId>(
    (v) => typeof v === 'string' && /^g-[\w-]+$/.test(v),
    'invalid group id (expected "g-..." prefix)',
  )
  .meta({ type: 'string', pattern: '^g-[\\w-]+$' })

export { trackIdSchema, elementIdSchema, assetIdSchema, markerIdSchema, groupIdSchema }

/**
 * Element position/scale/rotation. Coordinates are center-origin: (0, 0) is
 * the center of the project canvas, `x` grows right, `y` grows down, and the
 * element is anchored at its own center. Rotation is in degrees, clockwise.
 * Negative scale mirrors the element (scaleX < 0 = horizontal flip); zero is
 * rejected because it produces a degenerate transform.
 */
const scaleSchema = z
  .number()
  .refine((v) => v !== 0, 'scale may be negative (flip) but not zero')
export const transformSchema = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
    scaleX: scaleSchema.default(1),
    scaleY: scaleSchema.default(1),
    rotation: z.number().default(0),
  })
  .prefault({})

/**
 * Text outline/shadow are the SHARED appearance primitives (style.ts) —
 * media frames and layout slots carry the same shapes, which is what lets
 * style presets travel between text, clips, and slots.
 */
export const textStrokeSchema = strokeSchema
export const textShadowSchema = shadowSchema

export const textStyleSchema = z
  .object({
    fontFamily: z.string().default('sans-serif'),
    fontSize: z.number().positive().default(64),
    fontWeight: z.number().int().min(100).max(1000).default(600),
    fontStyle: z.enum(['normal', 'italic']).default('normal'),
    color: z.string().default('#ffffff'),
    align: z.enum(['left', 'center', 'right']).default('center'),
    backgroundColor: z.string().optional(),
    /** Extra space between characters in px (tracking). */
    letterSpacing: z.number().default(0),
    /** Line height as a multiple of fontSize. */
    lineHeight: z.number().positive().default(1.25),
    /** Case applied at render time; the stored text keeps the user's casing. */
    textTransform: z.enum(['none', 'uppercase', 'lowercase']).default('none'),
    stroke: textStrokeSchema.optional(),
    shadow: textShadowSchema.optional(),
  })
  .prefault({})

export const textBoxSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive().optional(),
  overflow: z.enum(['visible', 'clip']).default('clip'),
})

export const captionStyleSchema = z
  .object({
    fontFamily: z.string().default('sans-serif'),
    fontSize: z.number().positive().default(48),
    fontWeight: z.number().int().min(100).max(1000).default(700),
    color: z.string().default('#ffffff'),
    /** Color applied to the word under the playhead (karaoke highlight). */
    activeWordColor: z.string().optional(),
    backgroundColor: z.string().default('rgba(0, 0, 0, 0.55)'),
    position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
  })
  .prefault({})

/** Word timing relative to the owning caption element's `startMs`. */
export const captionWordSchema = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

/** Shared by elements the compositor paints (video/image/text). */
const visualShape = {
  /** Ordered effect stack, compiled to a canvas filter. See `effects.ts`. */
  effects: effectsSchema.optional(),
  /** Compositing blend mode against the layers below. Absent = normal. */
  blendMode: blendModeSchema.optional(),
  /**
   * Sub-frame motion blur on keyframed transform motion. Absent = off.
   * See `effects.ts`.
   */
  motionBlur: motionBlurSchema.optional(),
  /**
   * Transition INTO the next exactly-adjacent clip on the same track; this
   * element is the left side of the pair. See `transitions.ts`.
   */
  transition: transitionSchema.optional(),
}

const timingShape = {
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().min(MIN_ELEMENT_DURATION_MS),
  /**
   * Armed fixed-effect properties (Premiere stopwatch on): per-property
   * keyframe tracks, sorted and unique by element-local `timeMs`.
   */
  keyframes: keyframesSchema.optional(),
  /**
   * Elements sharing a `linkId` are linked (e.g. video + its detached audio):
   * UIs select and move them together. The engine stores the linkage; it does
   * not enforce cascading edits.
   */
  linkId: z.string().optional(),
  /**
   * Elements sharing a `groupId` are one editable timeline item made from
   * multiple clips. This is separate from linkId, which remains audio/link-pair
   * semantics.
   */
  groupId: groupIdSchema.optional(),
}

/**
 * Frame styling for rect-framed media (video/image): the same basics layout
 * slots have, as element-level fields. Radius is a fraction of the frame's
 * short edge and crop is normalized source space, so values are resolution-
 * independent and style presets transfer across surfaces.
 */
const frameStyleShape = {
  /** Corner radius as a fraction of the frame's short edge (0..0.5). */
  cornerRadius: z.number().min(0).max(0.5).optional(),
  /** Border painted inside the frame bounds. */
  stroke: strokeSchema.optional(),
  /** Drop shadow behind the (rounded) frame. */
  shadow: shadowSchema.optional(),
  /** Crop mask: the kept source region becomes the element's frame. */
  crop: cropSchema.optional(),
}

/** Audio fade envelope: linear ramps over the clip's head/tail. See audio.ts. */
const fadeShape = {
  /** Audio fade-in length from the clip's start (ms). Absent = none. */
  fadeInMs: z.number().int().nonnegative().optional(),
  /** Audio fade-out length before the clip's end (ms). Absent = none. */
  fadeOutMs: z.number().int().nonnegative().optional(),
}

const videoShape = {
  assetId: assetIdSchema,
  /** Offset into the source media where playback starts. */
  trimStartMs: z.number().int().nonnegative().default(0),
  /**
   * Time remap (speed): element-local output ms → source ms relative to
   * `trimStartMs`. See `speed.ts`. Absent = 1x.
   */
  timeMap: timeMapSchema.optional(),
  /** Play the trimmed source span backward. See `getSourceTimeMs`. */
  reversed: z.boolean().optional(),
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  ...fadeShape,
  ...visualShape,
  ...frameStyleShape,
}

const audioShape = {
  assetId: assetIdSchema,
  trimStartMs: z.number().int().nonnegative().default(0),
  /** Time remap (speed); see `speed.ts`. Absent = 1x. */
  timeMap: timeMapSchema.optional(),
  /** Play the trimmed source span backward. See `getSourceTimeMs`. */
  reversed: z.boolean().optional(),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  ...fadeShape,
}

const imageShape = {
  assetId: assetIdSchema,
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  ...visualShape,
  ...frameStyleShape,
}

const textShape = {
  text: z.string(),
  style: textStyleSchema,
  /**
   * Per-range style OVERRIDES over `style`, by character offset into
   * `text`. Metrics-stable properties only (color/weight/italic) — font
   * size and family stay element-global. See rich-text.ts.
   */
  runs: z.array(textRunSchema).optional(),
  box: textBoxSchema.optional(),
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  ...visualShape,
}

const multicamSourceSchema = z.object({
  /** Role key referenced by layout slots ('screen', 'camera', ...). */
  key: z.string().min(1),
  assetId: assetIdSchema,
  /** Where this source's media starts at the multicam's start (also the sync nudge). */
  trimStartMs: z.number().int().nonnegative().default(0),
})

const angleCutSchema = z.object({
  /** Element-local time the cut takes effect; first cut is at 0. */
  atMs: z.number().int().nonnegative(),
  /** Layout from `project.layouts` active until the next cut. */
  layoutId: z.string().min(1),
})

/**
 * A multicam clip: N synced sources composed by the layout active at each
 * point of its `angles` switch list. The unit of switching is the LAYOUT
 * (screen+cam vs cam-only), Premiere's multicam adapted to talking-head
 * editing. See multicam.ts and layouts.ts.
 */
const multicamShape = {
  sources: z.array(multicamSourceSchema).min(1),
  angles: z.array(angleCutSchema).min(1),
  /**
   * Uniform transition blended at EVERY angle cut (omit = hard jump cuts).
   * One setting standardizes the whole switch list; the window is centered
   * on each cut and clamped so neighboring windows never overlap.
   */
  angleTransition: transitionSchema.optional(),
  /** Key of the source whose audio plays (omit to mute all sources). */
  audioSource: z.string().optional(),
  /** Time remap (speed) for the whole multicam; see `speed.ts`. */
  timeMap: timeMapSchema.optional(),
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  ...fadeShape,
  ...visualShape,
}

const captionShape = {
  text: z.string(),
  /** Optional word-level timings, relative to `startMs`. */
  words: z.array(captionWordSchema).optional(),
  style: captionStyleSchema,
}

// ---------------------------------------------------------------------------
// The element-type registry's public face: registering a type composes its
// own fields with the shared id/type/timing fields and makes it a full
// citizen of the document — it parses in saved projects, splits, keyframes,
// validates, and describes itself to agents. The built-ins below use this
// exact API; custom types call it the same way (then register a renderer in
// @mcut/compositor and, optionally, UI chrome in the webapp).
// ---------------------------------------------------------------------------

export interface ElementTypeConfig {
  type: string
  /** The type's OWN fields — id/type/start/duration/keyframes/linkId/groupId are composed in. */
  shape: z.ZodRawShape
  /** Fixed-effect properties this type animates (see keyframes.ts). */
  keyframeable?: readonly string[]
  onSplit?: ElementTypeEntry['onSplit']
  validate?: ElementTypeEntry['validate']
  describe?: ElementTypeEntry['describe']
  frameRequests?: ElementTypeEntry['frameRequests']
}

const composeFull = <const K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ id: elementIdSchema, type: z.literal(type), ...timingShape, ...shape })
const composeInput = <const K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ id: elementIdSchema.optional(), type: z.literal(type), ...timingShape, ...shape })

export function registerTimelineElementType(config: ElementTypeConfig): void {
  registerElementTypeEntry({
    type: config.type,
    fullSchema: composeFull(config.type, config.shape),
    inputSchema: composeInput(config.type, config.shape),
    keyframeable: config.keyframeable ?? [],
    ...(config.onSplit ? { onSplit: config.onSplit } : {}),
    ...(config.validate ? { validate: config.validate } : {}),
    ...(config.describe ? { describe: config.describe } : {}),
    ...(config.frameRequests ? { frameRequests: config.frameRequests } : {}),
  })
}

// Static per-type schemas: the source of the exported TS types, and reused
// for the registry so the dynamic union validates identically.
export const videoElementSchema = composeFull('video', videoShape)
export const audioElementSchema = composeFull('audio', audioShape)
export const imageElementSchema = composeFull('image', imageShape)
export const textElementSchema = composeFull('text', textShape)
export const captionElementSchema = composeFull('caption', captionShape)
export const multicamElementSchema = composeFull('multicam', multicamShape)
export const multicamSourceRefSchema = multicamSourceSchema

/**
 * Every registered element type (dynamic: includes custom registrations).
 * Parsing routes through the registry so saved projects containing custom
 * types round-trip once their plugin is loaded.
 */
export const elementSchema = anyElementSchema as z.ZodType<TimelineElement, unknown>
/** Like {@link elementSchema} but `id` is optional (generated on insert). */
export const elementInputSchema = anyElementInputSchema as z.ZodType<TimelineElement, unknown>

export const assetRefSchema = z.object({
  id: assetIdSchema,
  kind: z.enum(['video', 'audio', 'image']),
  /**
   * Object URL, data URL, or remote URL. Projects stay JSON-serializable —
   * but treat this as a RUNTIME BINDING, not identity: object URLs are dead
   * after a reload, so persistence layers re-resolve `src` on load (e.g. from
   * OPFS via `hash`) and relink UIs match on `hash`/`name`.
   */
  src: z.string(),
  /** Content hash of the media file (stable identity across reloads/moves). */
  hash: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  /**
   * True when the browser's native media elements can preview this asset.
   * Containers such as Matroska may import/export through Mediabunny while
   * still needing decoded-frame fallback for interactive canvas preview.
   */
  nativePreview: z.boolean().optional(),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/**
 * A timeline marker: a named point on the project's time ruler (navigation,
 * notes, keyword hits). Markers live on the project, not on tracks/elements.
 */
export const markerSchema = z.object({
  id: markerIdSchema,
  timeMs: z.number().int().nonnegative(),
  label: z.string().optional(),
  /** Any CSS color; UIs fall back to their accent color when absent. */
  color: z.string().optional(),
})

export const trackSchema = z.object({
  id: trackIdSchema,
  name: z.string(),
  /** Audio from this track is silenced. */
  muted: z.boolean().default(false),
  /** Visuals from this track are not rendered. */
  hidden: z.boolean().default(false),
  /** UI hint: track rejects edits. The engine does not enforce this. */
  locked: z.boolean().default(false),
  /** When enabled, edits compact this track so clips keep no gaps between them. */
  magnetic: z.boolean().default(false),
  /** Sorted by `startMs`; never overlapping in time. */
  elements: z.array(elementSchema).default([]),
})

export const projectSchema = z.object({
  /**
   * Project format version (see `migrations.ts`). `parseProject` migrates
   * older documents before validating; the default covers in-memory creation.
   */
  version: z.literal(PROJECT_VERSION).default(PROJECT_VERSION),
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  /** Render order: index 0 is painted first (bottom); last is topmost. */
  tracks: z.array(trackSchema).default([]),
  assets: z.record(z.string(), assetRefSchema).default({}),
  /** Multicam layout templates this project references. See layouts.ts. */
  layouts: z.array(layoutSchema).default([]),
  /** Named inspector value bundles (style presets). See presets.ts. */
  presets: z.array(propertyPresetSchema).default([]),
  /** Timeline markers, sorted by `timeMs` (the commands keep them sorted). */
  markers: z.array(markerSchema).default([]),
})

export type Transform = z.infer<typeof transformSchema>
export type TextStyle = z.infer<typeof textStyleSchema>
export type TextStroke = z.infer<typeof textStrokeSchema>
export type TextShadow = z.infer<typeof textShadowSchema>
export type TextBox = z.infer<typeof textBoxSchema>
export type CaptionStyle = z.infer<typeof captionStyleSchema>
export type CaptionWord = z.infer<typeof captionWordSchema>
export type VideoElement = z.infer<typeof videoElementSchema>
export type AudioElement = z.infer<typeof audioElementSchema>
export type ImageElement = z.infer<typeof imageElementSchema>
export type TextElement = z.infer<typeof textElementSchema>
export type CaptionElement = z.infer<typeof captionElementSchema>
export type MulticamElement = z.infer<typeof multicamElementSchema>
export type MulticamSource = z.infer<typeof multicamSourceRefSchema>
export type AngleCutRef = MulticamElement['angles'][number]
/**
 * Named to avoid colliding with the DOM `Element` type. Statically this is
 * the union of BUILT-IN types; custom registered types parse at runtime and
 * surface as this union (consumers narrowing on `type` fall through their
 * default branches; plugin code casts to its own type).
 */
export type TimelineElement =
  | VideoElement
  | AudioElement
  | ImageElement
  | TextElement
  | CaptionElement
  | MulticamElement
type InputOf<S extends z.ZodType> = Omit<z.input<S>, 'id'> & { id?: ElementId }
export type TimelineElementInput =
  | InputOf<typeof videoElementSchema>
  | InputOf<typeof audioElementSchema>
  | InputOf<typeof imageElementSchema>
  | InputOf<typeof textElementSchema>
  | InputOf<typeof captionElementSchema>
  | InputOf<typeof multicamElementSchema>
export type AssetRef = z.infer<typeof assetRefSchema>
export type AssetKind = AssetRef['kind']
export type Marker = z.infer<typeof markerSchema>
export type Track = z.infer<typeof trackSchema>
export type Project = z.infer<typeof projectSchema>

// ---------------------------------------------------------------------------
// Built-in element types, registered through the same API custom types use.
// The hooks here are the single source of truth the engine consults for
// splitting, validation, summaries, and frame decoding.
// ---------------------------------------------------------------------------

const MOTION_KEYFRAMES = ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation', 'opacity', 'blur'] as const

const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

/** describe() for asset-backed clips: name + trim + speed. */
function describeAssetClip(raw: Record<string, unknown>, rawProject: unknown): string {
  const element = raw as unknown as VideoElement | AudioElement | ImageElement
  const project = rawProject as Project
  const asset = project.assets[element.assetId]
  let what = `${element.type} ${asset?.name ?? element.assetId}`
  if ('trimStartMs' in element && element.trimStartMs > 0) {
    what += ` (trim-in ${fmtSeconds(element.trimStartMs)})`
  }
  if ('timeMap' in element && element.timeMap) {
    const speed = getAverageSpeed(element)
    what += element.timeMap.length > 2 ? ` (speed ramp, avg ${speed.toFixed(2)}x)` : ` (speed ${speed.toFixed(2)}x)`
  }
  if ('reversed' in element && element.reversed) what += ' (reversed)'
  return what
}

/** validate() for asset-backed clips: asset exists; trims stay inside it. */
function validateAssetClip(rawProject: unknown, raw: Record<string, unknown>): void {
  const element = raw as unknown as VideoElement | AudioElement | ImageElement
  const project = rawProject as Project
  const asset = project.assets[element.assetId]
  if (!asset) throw new CommandError('unknown-asset', `no asset "${element.assetId}"`)
  if (element.type === 'image') return
  // With a timeMap the consumed source span is the map's last value.
  const sourceSpanMs = getSourceSpanMs(element)
  if (asset.durationMs !== undefined && element.trimStartMs + sourceSpanMs > asset.durationMs) {
    throw new CommandError(
      'out-of-bounds',
      `element plays past the end of asset "${asset.id}" ` +
        `(trimStartMs ${element.trimStartMs} + source span ${sourceSpanMs} > ${asset.durationMs})`,
    )
  }
}

/** onSplit() for trimmed media: the timeMap carries the offset, else the trim does. */
function splitTrimmedMedia({ element, left, right, offsetMs }: {
  element: Record<string, unknown>
  left: Record<string, unknown>
  right: Record<string, unknown>
  offsetMs: number
}): void {
  const source = element as unknown as VideoElement | AudioElement
  const originalSpanMs = getSourceSpanMs(source)
  if (source.timeMap) {
    const halves = splitTimeMap(source.timeMap, offsetMs)
    left.timeMap = halves.left
    right.timeMap = halves.right
  } else if (!source.reversed) {
    right.trimStartMs = source.trimStartMs + offsetMs
  }
  if (source.reversed) {
    // Reversed clips play the source backward, so the LEFT half holds the
    // LATER source span: shift its trim by what the right half consumes.
    // (The right half keeps the original trim — the mirror of the forward
    // rule above.) Works with and without a timeMap.
    const leftSpanMs = getSourceSpanMs(left as unknown as VideoElement | AudioElement)
    left.trimStartMs = source.trimStartMs + (originalSpanMs - leftSpanMs)
  }
  // Fades stay with their edge: the fade-in belongs to the left half, the
  // fade-out to the right. Remove the far edge's fade from each half.
  if (source.fadeOutMs !== undefined) delete left.fadeOutMs
  if (source.fadeInMs !== undefined) delete right.fadeInMs
}

registerTimelineElementType({
  type: 'video',
  shape: videoShape,
  keyframeable: [...MOTION_KEYFRAMES, 'volume'],
  describe: describeAssetClip,
  validate: validateAssetClip,
  onSplit: splitTrimmedMedia,
  frameRequests: (rawProject, raw, timelineMs) => {
    const element = raw as unknown as VideoElement
    void rawProject
    return [
      {
        assetId: element.assetId,
        sourceTimeMs: Math.max(0, getSourceTimeMs(element, timelineMs - element.startMs)),
      },
    ]
  },
})

registerTimelineElementType({
  type: 'audio',
  shape: audioShape,
  keyframeable: ['volume'],
  describe: describeAssetClip,
  validate: validateAssetClip,
  onSplit: splitTrimmedMedia,
})

registerTimelineElementType({
  type: 'image',
  shape: imageShape,
  keyframeable: [...MOTION_KEYFRAMES],
  describe: describeAssetClip,
  validate: validateAssetClip,
  frameRequests: (rawProject, raw) => {
    void rawProject
    return [{ assetId: (raw as unknown as ImageElement).assetId, sourceTimeMs: 0 }]
  },
})

registerTimelineElementType({
  type: 'text',
  shape: textShape,
  // letterSpacing animates the classic title-tracking reveal.
  keyframeable: [...MOTION_KEYFRAMES, 'letterSpacing'],
  describe: (raw) => `text "${(raw as unknown as TextElement).text.slice(0, 40)}"`,
})

registerTimelineElementType({
  type: 'caption',
  shape: captionShape,
  describe: (raw) => `caption "${(raw as unknown as CaptionElement).text.slice(0, 40)}"`,
  onSplit: ({ left, right, offsetMs }) => {
    const l = left as unknown as CaptionElement
    const r = right as unknown as CaptionElement
    const words = l.words ?? []
    l.words = words.filter((w) => w.startMs < offsetMs)
    r.words = words
      .filter((w) => w.startMs >= offsetMs)
      .map((w) => ({ ...w, startMs: w.startMs - offsetMs, endMs: w.endMs - offsetMs }))
    l.text = l.words.map((w) => w.text).join(' ') || l.text
    r.text = r.words.map((w) => w.text).join(' ') || r.text
  },
})

registerTimelineElementType({
  type: 'multicam',
  shape: multicamShape,
  keyframeable: [...MOTION_KEYFRAMES, 'volume'],
  describe: (raw, rawProject) => {
    const element = raw as unknown as MulticamElement
    const project = rawProject as Project
    const cuts = element.angles
      .map((a) => {
        const layout = project.layouts.find((l) => l.id === a.layoutId)
        return `${fmtSeconds(a.atMs)}→${layout?.name ?? a.layoutId}`
      })
      .join(', ')
    return (
      `multicam [${element.sources.map((src) => src.key).join(' + ')}]` +
      ` cuts: ${cuts}` +
      (element.audioSource ? ` (audio: ${element.audioSource})` : '')
    )
  },
  validate: (rawProject, raw) => {
    const element = raw as unknown as MulticamElement
    const project = rawProject as Project
    for (const source of element.sources) {
      if (!project.assets[source.assetId]) {
        throw new CommandError('unknown-asset', `no asset "${source.assetId}" (source "${source.key}")`)
      }
    }
  },
  onSplit: ({ element, left, right, offsetMs }) => {
    const source = element as unknown as MulticamElement
    const l = left as unknown as MulticamElement
    const r = right as unknown as MulticamElement
    const angleHalves = splitAngles(source.angles, offsetMs)
    l.angles = angleHalves.left
    r.angles = angleHalves.right
    if (source.timeMap) {
      const halves = splitTimeMap(source.timeMap, offsetMs)
      l.timeMap = halves.left
      r.timeMap = halves.right
    } else {
      r.sources = r.sources.map((s) => ({ ...s, trimStartMs: s.trimStartMs + offsetMs }))
    }
  },
  frameRequests: (rawProject, raw, timelineMs) => {
    const element = raw as unknown as MulticamElement
    const project = rawProject as Project
    // Inside an angle-cut blend window both layouts are on screen, so both
    // sets of sources need frames (render/export parity with the renderer).
    const window = getAngleTransitionAt(element, timelineMs - element.startMs)
    const layouts = window
      ? [getLayout(project.layouts, window.fromLayoutId), getLayout(project.layouts, window.toLayoutId)]
      : [getActiveLayout(project, element, timelineMs)]
    const requests: Array<{ assetId: string; sourceTimeMs: number }> = []
    const seen = new Set<string>()
    for (const layout of layouts) {
      for (const slot of layout?.slots ?? []) {
        const source = element.sources.find((s) => s.key === slot.source)
        if (!source || seen.has(source.key)) continue
        seen.add(source.key)
        requests.push({
          assetId: source.assetId,
          sourceTimeMs: getMulticamSourceTimeMs(element, source, timelineMs),
        })
      }
    }
    return requests
  },
})

/** The engine-facing accessor (typed re-export of the registry lookup). */
export { getElementType, listElementTypes } from './element-registry'

export interface CreateProjectOptions {
  id?: string
  name?: string
  width?: number
  height?: number
  fps?: number
}

export function createProject(options: CreateProjectOptions = {}): Project {
  return projectSchema.parse({
    id: options.id ?? createProjectId(),
    name: options.name ?? 'Untitled',
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    fps: options.fps ?? 30,
    tracks: [
      // Deterministic id: a fresh project is created during SSR and again on
      // the client, and the track id renders into the DOM (data-mcut-lane) —
      // a random id here is a hydration mismatch. Ids only need to be unique
      // within a project; tracks added later use createTrackId().
      { id: 't-default', name: 'Track 1', elements: [] },
    ],
    assets: {},
  })
}

/**
 * Parse and validate an untrusted project payload (e.g. persisted JSON),
 * migrating documents written by older releases up to the current format.
 * Throws `ProjectFormatError` for documents from a newer mcut.
 */
export function parseProject(data: unknown): Project {
  return projectSchema.parse(migrateProject(data))
}
