import { z } from 'zod'
import { assertNever } from './errors'

const effectShape = <const K extends string, S extends z.ZodRawShape>(type: K, shape: S) =>
  z.object({ type: z.literal(type), enabled: z.boolean().default(true), ...shape })

const amount01 = (defaultValue: number) => ({
  amount: z.number().min(0).max(1).default(defaultValue),
})

const curvePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const effectSchema = z.discriminatedUnion('type', [
  effectShape('blur', { radius: z.number().min(0).max(200).default(8) }),
  effectShape('brightness', { amount: z.number().min(0).max(4).default(1.1) }),
  effectShape('contrast', { amount: z.number().min(0).max(4).default(1.1) }),
  effectShape('saturate', { amount: z.number().min(0).max(4).default(1.25) }),
  effectShape('grayscale', amount01(1)),
  effectShape('sepia', amount01(1)),
  effectShape('hue-rotate', { degrees: z.number().min(-360).max(360).default(90) }),
  effectShape('invert', amount01(1)),
  effectShape('drop-shadow', {
    offsetX: z.number().default(0),
    offsetY: z.number().default(8),
    blur: z.number().min(0).max(100).default(16),
    color: z.string().default('rgba(0, 0, 0, 0.6)'),
  }),
  effectShape('css', { filter: z.string().min(1) }),
  effectShape('chroma-key', {
    keyColor: z.string().default('#00ff00'),
    tolerance: z.number().min(0).max(1).default(0.25),
    softness: z.number().min(0).max(1).default(0.1),
    spillSuppression: z.number().min(0).max(1).default(0.5),
  }),
  effectShape('curves', {
    rgb: z.array(curvePointSchema).optional(),
    red: z.array(curvePointSchema).optional(),
    green: z.array(curvePointSchema).optional(),
    blue: z.array(curvePointSchema).optional(),
  }),
  effectShape('lut3d', {
    lutId: z.string().min(1),
    intensity: z.number().min(0).max(1).default(1),
  }),
])

export const effectsSchema = z.array(effectSchema)

export type Effect = z.infer<typeof effectSchema>
export type EffectType = Effect['type']
export type EffectOfType<K extends EffectType> = Extract<Effect, { type: K }>
export type CurvePoint = z.infer<typeof curvePointSchema>

export const EFFECT_TYPES: readonly EffectType[] = effectSchema.options.map(
  (option) => option.shape.type.value,
)

export interface EffectParam<K extends EffectType = EffectType> {
  key: Exclude<keyof EffectOfType<K>, 'type' | 'enabled'>
  min: number
  max: number
  unit?: string
}

export const EFFECT_PARAMS: { readonly [K in EffectType]?: EffectParam<K> } = {
  blur: { key: 'radius', min: 0, max: 100, unit: 'px' },
  brightness: { key: 'amount', min: 0, max: 3 },
  contrast: { key: 'amount', min: 0, max: 3 },
  saturate: { key: 'amount', min: 0, max: 3 },
  grayscale: { key: 'amount', min: 0, max: 1 },
  sepia: { key: 'amount', min: 0, max: 1 },
  'hue-rotate': { key: 'degrees', min: -180, max: 180, unit: '°' },
  invert: { key: 'amount', min: 0, max: 1 },
  'drop-shadow': { key: 'blur', min: 0, max: 100, unit: 'px' },
  'chroma-key': { key: 'tolerance', min: 0, max: 1 },
}

export function effectToFilter(effect: Effect): string {
  switch (effect.type) {
    case 'blur':
      return effect.radius > 0 ? `blur(${effect.radius}px)` : ''
    case 'brightness':
      return effect.amount !== 1 ? `brightness(${effect.amount})` : ''
    case 'contrast':
      return effect.amount !== 1 ? `contrast(${effect.amount})` : ''
    case 'saturate':
      return effect.amount !== 1 ? `saturate(${effect.amount})` : ''
    case 'grayscale':
      return effect.amount > 0 ? `grayscale(${effect.amount})` : ''
    case 'sepia':
      return effect.amount > 0 ? `sepia(${effect.amount})` : ''
    case 'hue-rotate':
      return effect.degrees !== 0 ? `hue-rotate(${effect.degrees}deg)` : ''
    case 'invert':
      return effect.amount > 0 ? `invert(${effect.amount})` : ''
    case 'drop-shadow':
      return `drop-shadow(${effect.offsetX}px ${effect.offsetY}px ${effect.blur}px ${effect.color})`
    case 'css':
      return effect.filter
    case 'chroma-key':
    case 'curves':
    case 'lut3d':
      return ''
    default:
      return assertNever(effect)
  }
}

export function buildFilterString(effects: readonly Effect[] | undefined): string {
  if (!effects || effects.length === 0) return ''
  const parts: string[] = []
  for (const effect of effects) {
    if (!effect.enabled) continue
    const fragment = effectToFilter(effect)
    if (fragment) parts.push(fragment)
  }
  return parts.join(' ')
}

/**
 * Per-element motion blur (After Effects' layer motion blur model): the
 * compositor re-samples the element's animated transform at sub-frame times
 * inside a shutter window centered on the frame and accumulates the passes.
 * Only KEYFRAMED transform motion blurs — static clips and source-footage
 * motion are unaffected. Deterministic: the same frame always blurs the same
 * way, in preview and export.
 */
export const motionBlurSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Shutter angle in degrees: 360° exposes the full frame interval, 180°
   * (the default) is the film-camera look — half the interval.
   */
  shutterAngle: z.number().min(15).max(720).default(180),
})

export type MotionBlur = z.infer<typeof motionBlurSchema>

/**
 * Compositing blend modes (canvas `globalCompositeOperation` subset that maps
 * 1:1 onto the CSS/Photoshop blend modes).
 */
export const blendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
])

export type BlendMode = z.infer<typeof blendModeSchema>

export type CompositeOperation = 'source-over' | Exclude<BlendMode, 'normal'>

export function toCompositeOperation(mode: BlendMode | undefined): CompositeOperation {
  return mode === undefined || mode === 'normal' ? 'source-over' : mode
}
