import { z } from 'zod'
import { createElementId } from './id'
import { frameToMs } from './time'
import {
  MIN_ELEMENT_DURATION_MS,
  textStyleSchema,
  type Project,
  type TextElement,
  type TextStyle,
  type TimelineElement,
} from './model'

/**
 * Thumbnails: a composition recipe for the video's FIRST FIVE FRAMES — real
 * elements on a dedicated topmost "Thumbnail" track, so unlike CapCut's
 * cover (project metadata that vanishes on export) the cover is baked into
 * the exported video by construction, remains hand-editable on the canvas,
 * and can be re-captured as a reusable template.
 *
 * Template geometry is normalized (0..1 rects, font sizes relative to 1080p)
 * so one template fits any project size — louisville's draft pattern.
 */

export const THUMBNAIL_FRAME_COUNT = 5

const rectSchema = z.object({
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  w: z.number().positive().max(2),
  h: z.number().positive().max(2),
})

export const thumbnailItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    rect: rectSchema,
    text: z.string(),
    /** Editable hint shown in the panel ("Headline", "Episode label"). */
    role: z.string().default('Text'),
    style: textStyleSchema,
  }),
  z.object({
    /** A media drop target the panel fills (frame grab / image). */
    kind: z.literal('slot'),
    rect: rectSchema,
    fit: z.enum(['cover', 'contain']).default('cover'),
    label: z.string().default('Media'),
  }),
])

export const thumbnailTemplateSchema = z.object({
  name: z.string().min(1),
  items: z.array(thumbnailItemSchema).min(1),
})

export type ThumbnailItem = z.infer<typeof thumbnailItemSchema>
export type ThumbnailTemplate = z.infer<typeof thumbnailTemplateSchema>

/** Duration of the cover span: the first five frames, frame-quantized. */
export function thumbnailDurationMs(fps: number): number {
  return Math.max(MIN_ELEMENT_DURATION_MS, frameToMs(THUMBNAIL_FRAME_COUNT, fps))
}

/**
 * Scale every px-based style property between template space (1080p) and
 * project space — font size plus the tracking/stroke/shadow geometry that
 * must stay proportional to it.
 */
function scaleTextStyle(style: TextStyle, scale: number): TextStyle {
  return {
    ...style,
    fontSize: Math.max(8, Math.round(style.fontSize * scale)),
    letterSpacing: Math.round(style.letterSpacing * scale * 100) / 100,
    ...(style.stroke
      ? { stroke: { ...style.stroke, width: Math.max(0.5, style.stroke.width * scale) } }
      : {}),
    ...(style.shadow
      ? {
          shadow: {
            ...style.shadow,
            blur: style.shadow.blur * scale,
            offsetX: style.shadow.offsetX * scale,
            offsetY: style.shadow.offsetY * scale,
          },
        }
      : {}),
  }
}

/**
 * Expand a template's TEXT items into elements for the Thumbnail track.
 * Slots are panel affordances (filled with image elements by the UI), so
 * they expand to nothing here.
 */
export function expandThumbnailTemplate(
  project: Pick<Project, 'width' | 'height' | 'fps'>,
  template: ThumbnailTemplate,
): TimelineElement[] {
  const durationMs = thumbnailDurationMs(project.fps)
  const fontScale = project.height / 1080
  return template.items
    .filter((item): item is Extract<ThumbnailItem, { kind: 'text' }> => item.kind === 'text')
    .map((item) => ({
      id: createElementId(),
      type: 'text' as const,
      startMs: 0,
      durationMs,
      text: item.text,
      style: scaleTextStyle(item.style, fontScale),
      box: {
        width: Math.max(1, Math.round(item.rect.w * project.width)),
        overflow: 'visible' as const,
      },
      transform: {
        x: Math.round((item.rect.x + item.rect.w / 2 - 0.5) * project.width),
        y: Math.round((item.rect.y + item.rect.h / 2 - 0.5) * project.height),
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
      },
      opacity: 1,
    }))
}

/**
 * Capture the current Thumbnail-track composition back into a template
 * ("save my cover for the next video"). Text elements round-trip fully;
 * image elements become slots (geometry only — assets stay in the project).
 */
export function captureThumbnailTemplate(
  project: Project,
  name: string,
): ThumbnailTemplate | null {
  const track = findThumbnailTrack(project)
  if (!track || track.elements.length === 0) return null
  const fontScale = 1080 / project.height
  const items: ThumbnailItem[] = []
  for (const element of track.elements) {
    if (element.type === 'text') {
      const w = (element.box?.width ?? project.width * 0.4) / project.width
      const h = ((element.box?.height ?? element.style.fontSize * 1.4) / project.height) || 0.12
      items.push({
        kind: 'text',
        rect: {
          x: (element.transform.x + project.width / 2) / project.width - w / 2,
          y: (element.transform.y + project.height / 2) / project.height - h / 2,
          w,
          h,
        },
        text: element.text,
        role: 'Text',
        style: scaleTextStyle(element.style, fontScale),
      })
    } else if (element.type === 'image') {
      const asset = project.assets[element.assetId]
      const aw = (asset?.width ?? project.width) * Math.abs(element.transform.scaleX)
      const ah = (asset?.height ?? project.height) * Math.abs(element.transform.scaleY)
      items.push({
        kind: 'slot',
        rect: {
          x: (element.transform.x + project.width / 2 - aw / 2) / project.width,
          y: (element.transform.y + project.height / 2 - ah / 2) / project.height,
          w: Math.min(2, aw / project.width),
          h: Math.min(2, ah / project.height),
        },
        fit: 'cover',
        label: asset?.name ?? 'Media',
      })
    }
  }
  if (items.length === 0) return null
  return { name, items }
}

export const THUMBNAIL_TRACK_NAME = 'Thumbnail'

export function findThumbnailTrack(project: Project) {
  return [...project.tracks].reverse().find((t) => t.name === THUMBNAIL_TRACK_NAME) ?? null
}

const title = (overrides: Partial<z.input<typeof textStyleSchema>> = {}) =>
  textStyleSchema.parse({
    fontFamily: 'sans-serif',
    fontWeight: 900,
    color: '#ffffff',
    align: 'left',
    fontSize: 132,
    ...overrides,
  })

/**
 * Starter covers (talking-head/devlog flavored); the user library layers on
 * top. Font families here are a contract with the app's font library
 * (Google-catalog names) — unknown families degrade to sans-serif.
 */
export const THUMBNAIL_TEMPLATES: ThumbnailTemplate[] = [
  {
    name: 'Big title',
    items: [
      {
        kind: 'text',
        rect: { x: 0.06, y: 0.32, w: 0.62, h: 0.36 },
        text: 'BIG TITLE',
        role: 'Headline',
        style: title({
          fontFamily: 'Anton',
          fontWeight: 400,
          stroke: { color: '#000000', width: 6 },
          shadow: { color: 'rgba(0, 0, 0, 0.55)', blur: 18, offsetX: 0, offsetY: 8 },
        }),
      },
      {
        kind: 'text',
        rect: { x: 0.06, y: 0.74, w: 0.4, h: 0.1 },
        text: 'episode label',
        role: 'Label',
        style: title({
          fontFamily: 'Inter',
          fontSize: 44,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.85)',
          letterSpacing: 2,
          textTransform: 'uppercase',
        }),
      },
      { kind: 'slot', rect: { x: 0.62, y: 0.18, w: 0.34, h: 0.64 }, fit: 'cover', label: 'Face / frame' },
    ],
  },
  {
    name: 'Lower third',
    items: [
      {
        kind: 'text',
        rect: { x: 0.06, y: 0.66, w: 0.7, h: 0.18 },
        text: 'What we shipped',
        role: 'Headline',
        style: title({ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 96, backgroundColor: 'rgba(0,0,0,0.65)' }),
      },
    ],
  },
  {
    name: 'Center punch',
    items: [
      {
        kind: 'text',
        rect: { x: 0.1, y: 0.38, w: 0.8, h: 0.24 },
        text: 'ONE BIG WORD',
        role: 'Headline',
        style: title({
          fontFamily: 'Anton',
          fontWeight: 400,
          fontSize: 168,
          align: 'center',
          stroke: { color: '#000000', width: 8 },
          shadow: { color: 'rgba(0, 0, 0, 0.6)', blur: 24, offsetX: 0, offsetY: 10 },
        }),
      },
    ],
  },
]
