import { z } from 'zod'
import { createLayoutId } from './id'
import { strokeSchema } from './style'

/**
 * Layouts: named arrangements of multicam sources on the canvas ("screen +
 * camera PiP", "camera full", …). A layout is pure data — slot rects in
 * normalized canvas coordinates — resolved at render time by the multicam
 * renderer, and equally usable outside multicam to position plain clips.
 *
 * Layouts referenced by a project's multicam clips live IN the project
 * (`project.layouts`) so documents stay self-contained; app-level template
 * libraries are just a palette that copies layouts in.
 */
export const layoutSlotSchema = z.object({
  /** Which multicam source fills this slot (matched by source key). */
  source: z.string().min(1),
  /** Normalized rect on the project canvas: x/y = top-left, 0..1 of w/h. */
  rect: z.object({
    x: z.number().min(-1).max(2),
    y: z.number().min(-1).max(2),
    w: z.number().positive().max(3),
    h: z.number().positive().max(3),
  }),
  /** cover = fill the rect (crop), contain = letterbox inside it. */
  fit: z.enum(['cover', 'contain']).default('cover'),
  /** Which point of the source the cover crop keeps (0..1 each; 0.5 = center). */
  focus: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .default({ x: 0.5, y: 0.5 }),
  /** Corner radius as a fraction of the slot's short edge (0..0.5). */
  cornerRadius: z.number().min(0).max(0.5).default(0),
  /** Soft drop shadow behind the slot (PiP depth cue). */
  shadow: z.boolean().default(false),
  /** Border painted inside the slot bounds (shared primitive; style.ts). */
  stroke: strokeSchema.optional(),
})

export const layoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Paint order: first slot is painted first (bottom). */
  slots: z.array(layoutSlotSchema).min(1),
})

export type LayoutSlot = z.infer<typeof layoutSlotSchema>
export type Layout = z.infer<typeof layoutSchema>

/**
 * Starter layouts for the two-source talking-head setup (screen + camera).
 * Fresh ids per call — these get copied into projects, not shared.
 */
export function createDefaultLayouts(): Layout[] {
  const center = { x: 0.5, y: 0.5 }
  const pip = (corner: 'br' | 'bl'): LayoutSlot => ({
    source: 'camera',
    rect: { x: corner === 'br' ? 0.7 : 0.025, y: 0.69, w: 0.275, h: 0.275 },
    fit: 'cover',
    focus: center,
    cornerRadius: 0.12,
    shadow: true,
  })
  const full = (source: string): LayoutSlot => ({
    source,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    fit: 'cover',
    focus: center,
    cornerRadius: 0,
    shadow: false,
  })
  return [
    {
      id: createLayoutId(),
      name: 'Screen + Cam',
      slots: [full('screen'), pip('br')],
    },
    { id: createLayoutId(), name: 'Camera', slots: [full('camera')] },
    { id: createLayoutId(), name: 'Screen', slots: [full('screen')] },
    {
      id: createLayoutId(),
      name: 'Side by side',
      slots: [
        { source: 'screen', rect: { x: 0.015, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover', focus: center, cornerRadius: 0.06, shadow: false },
        { source: 'camera', rect: { x: 0.51, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover', focus: center, cornerRadius: 0.06, shadow: false },
      ],
    },
  ]
}

/** The layout with this id, or null. */
export function getLayout(layouts: readonly Layout[], layoutId: string): Layout | null {
  return layouts.find((l) => l.id === layoutId) ?? null
}
