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
import { frameStyleSchema, shadowSchema, strokeSchema } from './style'
import { textRunSchema } from './rich-text'
import { getMediaSourceDurationMs, type MediaClip } from './media-clip'
import { transitionSchema } from './transitions'
import { splitZoomRegions, zoomRegionSchema } from './zoom-regions'

export const MIN_ELEMENT_DURATION_MS = 10

const trackIdSchema = z
  .custom<TrackId>((v) => typeof v === 'string' && /^t-[\w-]+$/.test(v), 'invalid track id (expected "t-..." prefix)')
  .meta({ type: 'string', pattern: '^t-[\\w-]+$' })
const elementIdSchema = z
  .custom<ElementId>((v) => typeof v === 'string' && /^e-[\w-]+$/.test(v), 'invalid element id (expected "e-..." prefix)')
  .meta({ type: 'string', pattern: '^e-[\\w-]+$' })
const assetIdSchema = z
  .custom<AssetId>((v) => typeof v === 'string' && /^a-[\w-]+$/.test(v), 'invalid asset id (expected "a-..." prefix)')
  .meta({ type: 'string', pattern: '^a-[\\w-]+$' })
const markerIdSchema = z
  .custom<MarkerId>((v) => typeof v === 'string' && /^m-[\w-]+$/.test(v), 'invalid marker id (expected "m-..." prefix)')
  .meta({ type: 'string', pattern: '^m-[\\w-]+$' })
const groupIdSchema = z
  .custom<GroupId>((v) => typeof v === 'string' && /^g-[\w-]+$/.test(v), 'invalid group id (expected "g-..." prefix)')
  .meta({ type: 'string', pattern: '^g-[\\w-]+$' })

export { trackIdSchema, elementIdSchema, assetIdSchema, markerIdSchema, groupIdSchema }

const scaleSchema = z.number().refine((v) => v !== 0, 'scale may be negative (flip) but not zero')
export const transformSchema = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
    scaleX: scaleSchema.default(1),
    scaleY: scaleSchema.default(1),
    rotation: z.number().default(0),
  })
  .strict()
  .prefault({})

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
    letterSpacing: z.number().default(0),
    lineHeight: z.number().positive().default(1.25),
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
    activeWordColor: z.string().optional(),
    backgroundColor: z.string().default('rgba(0, 0, 0, 0.55)'),
    position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
  })
  .prefault({})

export const captionWordSchema = z
  .object({
    text: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .refine((word) => word.endMs >= word.startMs, 'caption word endMs must be >= startMs')

const visualShape = {
  effects: effectsSchema.optional(),
  blendMode: blendModeSchema.optional(),
  motionBlur: motionBlurSchema.optional(),
  transition: transitionSchema.optional(),
}

const timingShape = {
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().min(MIN_ELEMENT_DURATION_MS),
  keyframes: keyframesSchema.optional(),
  linkId: z.string().optional(),
  groupId: groupIdSchema.optional(),
}

const frameStyleShape = frameStyleSchema.shape

export const voiceSchema = z.object({
  enabled: z.boolean(),
  amount: z.number().min(0).max(1),
})

export type Voice = z.infer<typeof voiceSchema>

const mediaWindowShape = {
  trimStartMs: z.number().int().nonnegative().default(0),
  timeMap: timeMapSchema.optional(),
  reversed: z.boolean().optional(),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  voice: voiceSchema.optional(),
  fadeInMs: z.number().int().nonnegative().optional(),
  fadeOutMs: z.number().int().nonnegative().optional(),
}

const videoShape = {
  assetId: assetIdSchema,
  ...mediaWindowShape,
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  ...visualShape,
  ...frameStyleShape,
  zooms: z.array(zoomRegionSchema).optional(),
}

const audioShape = {
  assetId: assetIdSchema,
  ...mediaWindowShape,
}

const imageShape = {
  assetId: assetIdSchema,
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  ...visualShape,
  ...frameStyleShape,
  zooms: z.array(zoomRegionSchema).optional(),
}

const textShape = {
  text: z.string(),
  style: textStyleSchema,
  runs: z.array(textRunSchema).optional(),
  box: textBoxSchema.optional(),
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  ...visualShape,
}

const multicamSourceSchema = z.object({
  key: z.string().min(1),
  assetId: assetIdSchema,
  offsetMs: z.number().int().nonnegative().default(0),
})

const angleCutSchema = z.object({
  atMs: z.number().int().nonnegative(),
  layoutId: z.string().min(1),
})

const multicamShape = {
  sources: z.array(multicamSourceSchema).min(1),
  angles: z.array(angleCutSchema).min(1),
  angleTransition: transitionSchema.optional(),
  audioSource: z.string().optional(),
  ...mediaWindowShape,
  transform: transformSchema,
  opacity: z.number().min(0).max(1).default(1),
  ...visualShape,
  ...frameStyleShape,
  zooms: z.array(zoomRegionSchema).optional(),
}

const captionShape = {
  text: z.string(),
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

export type TimelineElement = VideoElement | AudioElement | ImageElement | TextElement | CaptionElement | MulticamElement

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

export const elementInputSchema: z.ZodType<TimelineElementDraft, TimelineElementInput> = z.discriminatedUnion('type', [
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
  src: z.string(),
  hash: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  nativePreview: z.boolean().optional(),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const markerSchema = z.object({
  id: markerIdSchema,
  timeMs: z.number().int().nonnegative(),
  label: z.string().optional(),
  color: z.string().optional(),
})

export const trackSchema = z.object({
  id: trackIdSchema,
  name: z.string(),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  magnetic: z.boolean().default(false),
  elements: z.array(elementSchema).default([]),
})

export const projectSchema = z.object({
  version: z.literal(PROJECT_VERSION).default(PROJECT_VERSION),
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  tracks: z.array(trackSchema).default([]),
  assets: z.record(z.string(), assetRefSchema).default({}),
  layouts: z.array(layoutSchema).default([]),
  presets: z.array(propertyPresetSchema).default([]),
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

function mustHaveAsset(project: Project, assetId: AssetId, owner = ''): AssetRef {
  const asset = project.assets[assetId]
  if (!asset) throw new CommandError('unknown-asset', `no asset "${assetId}"${owner}`)
  return asset
}

function validateMediaWindow(project: Project, clip: MediaClip): void {
  const sourceDurationMs = getMediaSourceDurationMs(project, clip)
  const sourceSpanMs = getSourceSpanMs(clip)
  if (sourceDurationMs !== undefined && clip.trimStartMs + sourceSpanMs > sourceDurationMs) {
    throw new CommandError(
      'out-of-bounds',
      `element "${clip.id}" plays past the end of its source (trimStartMs ${clip.trimStartMs} + source span ${sourceSpanMs} > ${sourceDurationMs})`,
    )
  }
}

function validateMulticamSources(project: Project, element: MulticamElement): void {
  for (const source of element.sources) {
    if (mustHaveAsset(project, source.assetId, ` (source "${source.key}")`).kind === 'image') {
      throw new CommandError('invalid-payload', `multicam source "${source.key}" is an image; sources must be video or audio`)
    }
  }
}

export function validateElement(project: Project, element: TimelineElement): void {
  switch (element.type) {
    case 'video':
    case 'audio':
      mustHaveAsset(project, element.assetId)
      return validateMediaWindow(project, element)
    case 'multicam':
      validateMulticamSources(project, element)
      return validateMediaWindow(project, element)
    case 'image':
      mustHaveAsset(project, element.assetId)
      return
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
  if ('zooms' in element && element.zooms && 'zooms' in left && 'zooms' in right) {
    const split = splitZoomRegions(element.zooms, offsetMs)
    left.zooms = split.left
    right.zooms = split.right
  }
  return { left, right }
}

function splitTrimmedMedia(element: MediaClip, offsetMs: number): SplitHalves<MediaClip> {
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
    left.trimStartMs = Math.floor(element.trimStartMs + (originalSpanMs - leftSpanMs))
  }
  if (element.fadeOutMs !== undefined) delete left.fadeOutMs
  if (element.fadeInMs !== undefined) delete right.fadeInMs
  return { left, right }
}

function splitCaption(element: CaptionElement, offsetMs: number): SplitHalves<CaptionElement> {
  const { left, right } = timingHalves(element, offsetMs)
  const words = element.words ?? []
  left.words = words.filter((w) => w.startMs < offsetMs)
  right.words = words.filter((w) => w.startMs >= offsetMs).map((w) => ({ ...w, startMs: w.startMs - offsetMs, endMs: w.endMs - offsetMs }))
  left.text = left.words.map((w) => w.text).join(' ') || left.text
  right.text = right.words.map((w) => w.text).join(' ') || right.text
  return { left, right }
}

export function splitElementAt(element: TimelineElement, offsetMs: number): SplitHalves {
  switch (element.type) {
    case 'video':
    case 'audio':
    case 'multicam':
      return splitTrimmedMedia(element, offsetMs)
    case 'image':
    case 'text':
      return timingHalves(element, offsetMs)
    case 'caption':
      return splitCaption(element, offsetMs)
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
    tracks: [{ id: 't-default', name: 'Track 1', elements: [] }],
    assets: {},
  })
}

export function parseProject(data: unknown): Project {
  return projectSchema.parse(migrateProject(data))
}
