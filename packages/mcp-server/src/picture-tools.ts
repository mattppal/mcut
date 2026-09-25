import { elementIdSchema } from '@mcut/timeline'
import { z } from 'zod'

const PICTURE_TARGET_INPUT = {
  elementId: elementIdSchema.describe('Video or multicam clip. Defaults to the first multicam, then the first video clip.').optional(),
  source: z.string().min(1).describe('Multicam only. The source key to read, such as "screen". Defaults to "screen", then the first video source.').optional(),
  startMs: z.number().min(0).describe('Timeline start in milliseconds. Defaults to the clip start.').optional(),
  endMs: z.number().min(0).describe('Timeline end in milliseconds. Defaults to the clip end.').optional(),
}

export const PICTURE_TOOL_INPUTS = {
  find_scene_changes: z.strictObject({
    ...PICTURE_TARGET_INPUT,
    stepMs: z
      .int()
      .min(100)
      .max(10_000)
      .default(500)
      .describe('Coarse sampling step in milliseconds. Each change is then refined to the exact frame. Defaults to 500.'),
    sensitivity: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe('0 to 1. Higher reports smaller changes. 0.5 reports a change when about 30% of the picture changes, such as a new page or a cut.'),
    maxChanges: z.int().min(1).max(200).default(40).describe('Keep at most this many changes, the largest first. Defaults to 40.'),
  }),
  get_contact_sheet: z.strictObject({
    ...PICTURE_TARGET_INPUT,
    timesMs: z.array(z.number().min(0)).min(1).max(48).describe('Timeline times to show, one tile each. Overrides count.').optional(),
    count: z.int().min(1).max(48).default(12).describe('Tiles spread evenly over the range when timesMs is not set. Defaults to 12.'),
    columns: z.int().min(1).max(12).describe('Tiles per row. Defaults to a square grid.').optional(),
    thumbWidth: z.int().min(80).max(640).default(320).describe('Tile width in pixels. Defaults to 320.'),
  }),
}

export const PICTURE_TOOL_DESCRIPTIONS = {
  find_scene_changes:
    'Live bridge only. Report the timeline times where the picture of one video clip or one multicam source changes, such as a new page in a screen recording or a cut. ' +
    'It compares downscaled frames every stepMs, then refines each change to the exact frame, in one call. ' +
    'Returns changes (timeMs and changed, the fraction of the picture that changed) and segments, the stable stretches between them. ' +
    'On a multicam it reads the "screen" source by default, so the camera overlay does not count. ' +
    'Call it before placing a detail zoom, then check the segments with get_contact_sheet, and set the zoom in, hold, and out inside the segment that shows the region.',
  get_contact_sheet:
    'Live bridge only. One PNG grid of thumbnails of one video clip or multicam source, each labelled with its timeline time in seconds, and the tile times as JSON. ' +
    'Pass timesMs, such as each segment start and midpoint from find_scene_changes, or count to spread tiles evenly over startMs to endMs.',
}

const contactSheetSchema = z.strictObject({
  mimeType: z.literal('image/png'),
  data: z.string().min(1),
  width: z.int().min(1),
  height: z.int().min(1),
  columns: z.int().min(1),
  elementId: elementIdSchema,
  source: z.string().optional(),
  tiles: z.array(z.strictObject({ timeMs: z.number().min(0) })).min(1),
})

export function contactSheetContent(raw: unknown) {
  const { mimeType, data, ...summary } = contactSheetSchema.parse(raw)
  return {
    content: [
      { type: 'image' as const, data, mimeType },
      { type: 'text' as const, text: JSON.stringify(summary) },
    ],
  }
}
