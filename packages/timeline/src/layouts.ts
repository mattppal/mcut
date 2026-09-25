import { z } from 'zod'
import { assertNever, CommandError } from './errors'
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

const slotAnchorSchema = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'])

export const slotResizeSchema = z.object({
  anchor: slotAnchorSchema.optional(),
  aspect: z.number().positive().optional(),
  widthPx: z.number().positive().optional(),
  heightPx: z.number().positive().optional(),
  scale: z.number().positive().optional(),
  keep: z.enum(['width', 'height', 'area']).optional(),
})

export type LayoutSlot = z.infer<typeof layoutSlotSchema>
export type Layout = z.infer<typeof layoutSchema>
export type SlotAnchor = z.infer<typeof slotAnchorSchema>
type SlotResize = z.infer<typeof slotResizeSchema>
type Rect = LayoutSlot['rect']

type Canvas = Pick<Project, 'width' | 'height'>

const ANCHOR_POINTS: Record<SlotAnchor, readonly [number, number]> = {
  'top-left': [0, 0],
  'top-right': [1, 0],
  'bottom-left': [0, 1],
  'bottom-right': [1, 1],
  center: [0.5, 0.5],
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000

function resizedSize(rect: Rect, canvas: Canvas, resize: SlotResize): Canvas {
  const width = rect.w * canvas.width
  const height = rect.h * canvas.height
  if (resize.widthPx !== undefined && resize.heightPx !== undefined) return { width: resize.widthPx, height: resize.heightPx }
  const aspect = resize.aspect ?? width / height
  if (resize.widthPx !== undefined) return { width: resize.widthPx, height: resize.widthPx / aspect }
  if (resize.heightPx !== undefined) return { width: resize.heightPx * aspect, height: resize.heightPx }
  const scale = resize.scale ?? 1
  const keep = resize.keep ?? 'area'
  switch (keep) {
    case 'width':
      return { width: width * scale, height: (width / aspect) * scale }
    case 'height':
      return { width: height * aspect * scale, height: height * scale }
    case 'area': {
      const area = width * height * scale * scale
      return { width: Math.sqrt(area * aspect), height: Math.sqrt(area / aspect) }
    }
    default:
      return assertNever(keep)
  }
}

function room(anchor: number, side: number, size: number, total: number): number {
  const before = side > 0 ? anchor / (side * size) : Infinity
  const after = side < 1 ? (total - anchor) / ((1 - side) * size) : Infinity
  return Math.min(before, after)
}

export function resizeSlotRect(rect: Rect, canvas: Canvas, resize: SlotResize & { anchor: SlotAnchor }): Rect {
  const size = resizedSize(rect, canvas, resize)
  const [sx, sy] = ANCHOR_POINTS[resize.anchor]
  const ax = Math.min(canvas.width, Math.max(0, (rect.x + sx * rect.w) * canvas.width))
  const ay = Math.min(canvas.height, Math.max(0, (rect.y + sy * rect.h) * canvas.height))
  const fit = Math.min(1, room(ax, sx, size.width, canvas.width), room(ay, sy, size.height, canvas.height))
  const w = round4((size.width * fit) / canvas.width)
  const h = round4((size.height * fit) / canvas.height)
  if (!(w > 0 && h > 0)) throw new CommandError('out-of-bounds', `the slot has no room to grow from its ${resize.anchor} anchor inside the frame`)
  return { x: round4(ax / canvas.width - sx * w), y: round4(ay / canvas.height - sy * h), w, h }
}

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
