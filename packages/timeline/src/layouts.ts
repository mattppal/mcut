import { z } from 'zod'
import { createLayoutId } from './id'
import { strokeSchema } from './style'

export const layoutSlotSchema = z.object({
  source: z.string().min(1),
  rect: z.object({
    x: z.number().min(-1).max(2),
    y: z.number().min(-1).max(2),
    w: z.number().positive().max(3),
    h: z.number().positive().max(3),
  }),
  fit: z.enum(['cover', 'contain']).default('cover'),
  focus: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .default({ x: 0.5, y: 0.5 }),
  cornerRadius: z.number().min(0).max(0.5).default(0),
  shadow: z.boolean().default(false),
  stroke: strokeSchema.optional(),
})

export const layoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slots: z.array(layoutSlotSchema).min(1),
})

export type LayoutSlot = z.infer<typeof layoutSlotSchema>
export type Layout = z.infer<typeof layoutSchema>

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
      name: 'Screen + Cam 3:4',
      slots: [
        { source: 'screen', rect: { x: 0.095, y: 0.05, w: 0.38, h: 0.9 }, fit: 'cover', focus: center, cornerRadius: 0.06, shadow: false },
        { source: 'camera', rect: { x: 0.525, y: 0.05, w: 0.38, h: 0.9 }, fit: 'cover', focus: center, cornerRadius: 0.06, shadow: false },
      ],
    },
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

export function getLayout(layouts: readonly Layout[], layoutId: string): Layout | null {
  return layouts.find((l) => l.id === layoutId) ?? null
}
