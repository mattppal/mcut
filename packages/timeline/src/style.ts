import { z } from 'zod'

export const strokeSchema = z.object({
  color: z.string().default('#000000'),
  width: z.number().positive(),
})

export const shadowSchema = z.object({
  color: z.string().default('rgba(0, 0, 0, 0.6)'),
  blur: z.number().nonnegative().default(12),
  offsetX: z.number().default(0),
  offsetY: z.number().default(6),
})

export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().positive().max(1),
    h: z.number().positive().max(1),
  })
  .refine((c) => c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001, 'crop must stay inside the source')

export const frameStyleSchema = z.object({
  crop: cropSchema.optional(),
  cornerRadius: z.number().min(0).max(0.5).optional(),
  stroke: strokeSchema.optional(),
  shadow: shadowSchema.optional(),
})

export const FRAME_STYLE_FIELDS = frameStyleSchema.keyof().options

export type Stroke = z.infer<typeof strokeSchema>
export type Shadow = z.infer<typeof shadowSchema>
export type Crop = z.infer<typeof cropSchema>
export type FrameStyle = z.infer<typeof frameStyleSchema>

export const DEFAULT_SHADOW: Shadow = { color: 'rgba(0, 0, 0, 0.6)', blur: 12, offsetX: 0, offsetY: 6 }
