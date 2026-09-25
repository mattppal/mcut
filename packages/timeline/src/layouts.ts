import { z } from 'zod'
import { createLayoutId } from './id'
import type { Project } from './model'
import { frameStyleSchema, type Shadow } from './style'

export const layoutSlotSchema = z.object({
  source: z.string().min(1),
  rect: z.object({
    x: z.number().min(-1).max(2),
    y: z.number().min(-1).max(2),
    w: z.number().positive().max(3),
    h: z.number().positive().max(3),
  }),
  fit: z.enum(['cover', 'contain']).default('cover'),
  ...frameStyleSchema.shape,
})

export const layoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slots: z.array(layoutSlotSchema).min(1),
})

export type LayoutSlot = z.infer<typeof layoutSlotSchema>
export type Layout = z.infer<typeof layoutSchema>

type Canvas = Pick<Project, 'width' | 'height'>

export function slotShadow(rect: { w: number; h: number }, canvas: Canvas): Shadow {
  const size = Math.min(rect.w * canvas.width, rect.h * canvas.height)
  return { color: 'rgba(0, 0, 0, 0.45)', blur: Math.round(size * 0.12), offsetX: 0, offsetY: Math.round(size * 0.04) }
}

export function createDefaultLayouts(canvas: Canvas): Layout[] {
  const pip = (corner: 'br' | 'bl'): LayoutSlot => {
    const rect = { x: corner === 'br' ? 0.7 : 0.025, y: 0.69, w: 0.275, h: 0.275 }
    return { source: 'camera', rect, fit: 'cover', cornerRadius: 0.12, shadow: slotShadow(rect, canvas) }
  }
  const full = (source: string): LayoutSlot => ({ source, rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' })
  const panel = (source: string, rect: LayoutSlot['rect']): LayoutSlot => ({ source, rect, fit: 'cover', cornerRadius: 0.06 })
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
      slots: [panel('screen', { x: 0.095, y: 0.05, w: 0.38, h: 0.9 }), panel('camera', { x: 0.525, y: 0.05, w: 0.38, h: 0.9 })],
    },
    {
      id: createLayoutId(),
      name: 'Side by side',
      slots: [panel('screen', { x: 0.015, y: 0.235, w: 0.475, h: 0.53 }), panel('camera', { x: 0.51, y: 0.235, w: 0.475, h: 0.53 })],
    },
  ]
}

export function getLayout(layouts: readonly Layout[], layoutId: string): Layout | null {
  return layouts.find((l) => l.id === layoutId) ?? null
}
