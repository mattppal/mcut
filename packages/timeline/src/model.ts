import { z } from 'zod'
import type { AssetId, ElementId, GroupId, MarkerId, TrackId } from './id'
import { createProjectId, createTrackId } from './id'
import { assertNever, CommandError } from './errors'
import { keyframesSchema, splitKeyframes, type KeyframeMap } from './keyframes'
import { migrateProject, PROJECT_VERSION } from './migrations'
import { getSourceSpanMs, splitTimeMap, timeMapSchema } from './speed'
import { blendModeSchema, effectsSchema, motionBlurSchema } from './effects'
import { layoutSchema } from './layouts'
import { propertyPresetSchema } from './presets'
import { cropSchema, shadowSchema, strokeSchema } from './style'
import { textRunSchema } from './rich-text'
import { splitAngles } from './multicam'
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

const composeFull = <const K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ id: elementIdSchema, type: z.literal(type), ...timingShape, ...shape })
const composeInput = <const K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ id: elementIdSchema.optional(), type: z.literal(type), ...timingShape, ...shape })

export const videoElementSchema = composeFull('video', videoShape)
export const audioElementSchema = composeFull('audio', audioShape)
export const imageElementSchema = composeFull('image', imageShape)
export const textElementSchema = composeFull('text', textShape)
export const captionElementSchema = composeFull('caption', captionShape)
export const multicamElementSchema = composeFull('multicam', multicamShape)

export type VideoElement = z.infer<typeof videoElementSchema>
export type AudioElement = z.infer<typeof audioElementSchema>
export type ImageElement = z.infer<typeof imageElementSchema>
export type TextElement = z.infer<typeof textElementSchema>
export type CaptionElement = z.infer<typeof captionElementSchema>
export type MulticamElement = z.infer<typeof multicamElementSchema>

export type TimelineElement =
  | VideoElement
  | AudioElement
  | ImageElement
  | TextElement
  | CaptionElement
  | MulticamElement

export type ElementType = TimelineElement['type']

export const elementSchema: z.ZodType<TimelineElement> = z.discriminatedUnion('type', [
  videoElementSchema,
  audioElementSchema,
  imageElementSchema,
  textElementSchema,
  captionElementSchema,
  multicamElementSchema,
])

type WithOptionalId<E> = Omit<E, 'id'> & { id?: ElementId }

export type TimelineElementInput =
  | WithOptionalId<z.input<typeof videoElementSchema>>
  | WithOptionalId<z.input<typeof audioElementSchema>>
  | WithOptionalId<z.input<typeof imageElementSchema>>
  | WithOptionalId<z.input<typeof textElementSchema>>
  | WithOptionalId<z.input<typeof captionElementSchema>>
  | WithOptionalId<z.input<typeof multicamElementSchema>>

export type TimelineElementDraft =
  | WithOptionalId<VideoElement>
  | WithOptionalId<AudioElement>
  | WithOptionalId<ImageElement>
  | WithOptionalId<TextElement>
  | WithOptionalId<CaptionElement>
  | WithOptionalId<MulticamElement>

export const elementInputSchema: z.ZodType<TimelineElementDraft, TimelineElementInput> =
  z.discriminatedUnion('type', [
    composeInput('video', videoShape),
    composeInput('audio', audioShape),
    composeInput('image', imageShape),
    composeInput('text', textShape),
    composeInput('caption', captionShape),
    composeInput('multicam', multicamShape),
  ])

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
export type MulticamSource = z.infer<typeof multicamSourceSchema>
export type AngleCutRef = MulticamElement['angles'][number]
export type AssetRef = z.infer<typeof assetRefSchema>
export type AssetKind = AssetRef['kind']
export type Marker = z.infer<typeof markerSchema>
export type Track = z.infer<typeof trackSchema>
export type Project = z.infer<typeof projectSchema>

function validateAssetClip(project: Project, element: VideoElement | AudioElement | ImageElement): void {
  const asset = project.assets[element.assetId]
  if (!asset) throw new CommandError('unknown-asset', `no asset "${element.assetId}"`)
  if (element.type === 'image') return
  const sourceSpanMs = getSourceSpanMs(element)
  if (asset.durationMs !== undefined && element.trimStartMs + sourceSpanMs > asset.durationMs) {
    throw new CommandError(
      'out-of-bounds',
      `element plays past the end of asset "${asset.id}" ` +
        `(trimStartMs ${element.trimStartMs} + source span ${sourceSpanMs} > ${asset.durationMs})`,
    )
  }
}

function validateMulticam(project: Project, element: MulticamElement): void {
  for (const source of element.sources) {
    if (!project.assets[source.assetId]) {
      throw new CommandError('unknown-asset', `no asset "${source.assetId}" (source "${source.key}")`)
    }
  }
}

export function validateElement(project: Project, element: TimelineElement): void {
  switch (element.type) {
    case 'video':
    case 'audio':
    case 'image':
      return validateAssetClip(project, element)
    case 'multicam':
      return validateMulticam(project, element)
    case 'text':
    case 'caption':
      return
    default:
      return assertNever(element)
  }
}

export interface SplitHalves<E extends TimelineElement = TimelineElement> {
  left: E
  right: E
}

function setKeyframes(element: TimelineElement, keyframes: KeyframeMap | undefined): void {
  if (keyframes) element.keyframes = keyframes
  else delete element.keyframes
}

function timingHalves<E extends TimelineElement>(element: E, offsetMs: number): SplitHalves<E> {
  const left: E = { ...element, durationMs: offsetMs }
  const right: E = {
    ...element,
    startMs: element.startMs + offsetMs,
    durationMs: element.durationMs - offsetMs,
  }
  if (element.keyframes) {
    const split = splitKeyframes(element.keyframes, offsetMs)
    setKeyframes(left, split.left)
    setKeyframes(right, split.right)
  }
  return { left, right }
}

function splitTrimmedMedia(
  element: VideoElement | AudioElement,
  offsetMs: number,
): SplitHalves<VideoElement | AudioElement> {
  const { left, right } = timingHalves(element, offsetMs)
  const originalSpanMs = getSourceSpanMs(element)
  if (element.timeMap) {
    const halves = splitTimeMap(element.timeMap, offsetMs)
    left.timeMap = halves.left
    right.timeMap = halves.right
  } else if (!element.reversed) {
    right.trimStartMs = element.trimStartMs + offsetMs
  }
  if (element.reversed) {
    const leftSpanMs = getSourceSpanMs(left)
    left.trimStartMs = element.trimStartMs + (originalSpanMs - leftSpanMs)
  }
  if (element.fadeOutMs !== undefined) delete left.fadeOutMs
  if (element.fadeInMs !== undefined) delete right.fadeInMs
  return { left, right }
}

function splitCaption(element: CaptionElement, offsetMs: number): SplitHalves<CaptionElement> {
  const { left, right } = timingHalves(element, offsetMs)
  const words = element.words ?? []
  left.words = words.filter((w) => w.startMs < offsetMs)
  right.words = words
    .filter((w) => w.startMs >= offsetMs)
    .map((w) => ({ ...w, startMs: w.startMs - offsetMs, endMs: w.endMs - offsetMs }))
  left.text = left.words.map((w) => w.text).join(' ') || left.text
  right.text = right.words.map((w) => w.text).join(' ') || right.text
  return { left, right }
}

function splitMulticam(element: MulticamElement, offsetMs: number): SplitHalves<MulticamElement> {
  const { left, right } = timingHalves(element, offsetMs)
  const angleHalves = splitAngles(element.angles, offsetMs)
  left.angles = angleHalves.left
  right.angles = angleHalves.right
  if (element.timeMap) {
    const halves = splitTimeMap(element.timeMap, offsetMs)
    left.timeMap = halves.left
    right.timeMap = halves.right
  } else {
    right.sources = right.sources.map((s) => ({ ...s, trimStartMs: s.trimStartMs + offsetMs }))
  }
  return { left, right }
}

export function splitElementAt(element: TimelineElement, offsetMs: number): SplitHalves {
  switch (element.type) {
    case 'video':
    case 'audio':
      return splitTrimmedMedia(element, offsetMs)
    case 'image':
    case 'text':
      return timingHalves(element, offsetMs)
    case 'caption':
      return splitCaption(element, offsetMs)
    case 'multicam':
      return splitMulticam(element, offsetMs)
    default:
      return assertNever(element)
  }
}

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
