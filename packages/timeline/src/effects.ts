import { z } from 'zod'

/**
 * Visual effects as data: an ordered stack of `{ type, ...params }` records
 * per element, compiled by the compositor into a canvas2d `ctx.filter`
 * string. Effect TYPES live in a registry (MLT's service + property-bag
 * pattern): each entry owns its zod params, its filter compiler, and an
 * optional primary-param descriptor that the inspector renders as a slider.
 * The built-ins register through the same API custom effects use, so a
 * custom effect parses in saved projects, validates, compiles, and gets UI
 * for free. Register at module load, before parsing projects.
 *
 * The `css` escape hatch accepts any raw CSS filter() value list, which is
 * how SVG/url() filters plug in without a new type.
 */

export interface EffectTypeConfig {
  type: string
  /** The effect's OWN params; `type` and `enabled` are composed in. */
  shape: z.ZodRawShape
  /** Compile to a CSS filter() fragment ('' when inert at these params). */
  toFilter: (effect: Record<string, unknown>) => string
  /** Primary scrubbable param for compact one-row UI (inspector slider). */
  param?: { key: string; min: number; max: number; unit?: string }
}

interface EffectTypeEntry extends EffectTypeConfig {
  schema: z.ZodType
}

const effectRegistry = new Map<string, EffectTypeEntry>()
let effectVersion = 0

export function registerEffectType(config: EffectTypeConfig): void {
  if (effectRegistry.has(config.type)) {
    throw new Error(`effect type "${config.type}" is already registered`)
  }
  effectRegistry.set(config.type, {
    ...config,
    schema: z.object({
      type: z.literal(config.type),
      enabled: z.boolean().default(true),
      ...config.shape,
    }),
  })
  effectVersion += 1
}

export function getEffectType(type: string): EffectTypeEntry | undefined {
  return effectRegistry.get(type)
}

/** Registration order = presentation order (effect pickers). */
export function listEffectTypes(): EffectTypeEntry[] {
  return [...effectRegistry.values()]
}

// Static built-in member types (custom effects surface as the union at
// runtime; plugin code casts to its own params type).
type BuiltinEffect<K extends string, P> = { type: K; enabled: boolean } & P
export type Effect =
  | BuiltinEffect<'blur', { radius: number }>
  | BuiltinEffect<'brightness', { amount: number }>
  | BuiltinEffect<'contrast', { amount: number }>
  | BuiltinEffect<'saturate', { amount: number }>
  | BuiltinEffect<'grayscale', { amount: number }>
  | BuiltinEffect<'sepia', { amount: number }>
  | BuiltinEffect<'hue-rotate', { degrees: number }>
  | BuiltinEffect<'invert', { amount: number }>
  | BuiltinEffect<'drop-shadow', { offsetX: number; offsetY: number; blur: number; color: string }>
  | BuiltinEffect<'css', { filter: string }>
export type EffectType = Effect['type']

let effectUnionCache: { version: number; schema: z.ZodType } | null = null

/** Every registered effect type (dynamic: custom registrations included). */
export const effectSchema = z.any().transform((value, ctx) => {
  if (!effectUnionCache || effectUnionCache.version !== effectVersion) {
    effectUnionCache = {
      version: effectVersion,
      schema: z.discriminatedUnion(
        'type',
        listEffectTypes().map((e) => e.schema) as never,
      ) as unknown as z.ZodType,
    }
  }
  const result = effectUnionCache.schema.safeParse(value)
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ ...issue } as Parameters<typeof ctx.addIssue>[0])
    }
    return z.NEVER
  }
  return result.data
}) as unknown as z.ZodType<Effect, unknown>

export const effectsSchema = z.array(effectSchema)

/**
 * Compile an effect stack to a canvas2d/CSS filter string ('' when inert).
 * Order matters: filters apply left to right, like the stack reads top down.
 */
export function buildFilterString(effects: readonly Effect[] | undefined): string {
  if (!effects || effects.length === 0) return ''
  const parts: string[] = []
  for (const effect of effects) {
    if (!effect.enabled) continue
    const fragment = getEffectType(effect.type)?.toFilter(effect as Record<string, unknown>) ?? ''
    if (fragment) parts.push(fragment)
  }
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Built-in effects, registered through the same API custom effects use.
// ---------------------------------------------------------------------------

const amount01 = (defaultValue: number) => ({
  amount: z.number().min(0).max(1).default(defaultValue),
})

registerEffectType({
  type: 'blur',
  shape: { radius: z.number().min(0).max(200).default(8) },
  toFilter: (e) => ((e.radius as number) > 0 ? `blur(${e.radius}px)` : ''),
  param: { key: 'radius', min: 0, max: 100, unit: 'px' },
})
registerEffectType({
  type: 'brightness',
  shape: { amount: z.number().min(0).max(4).default(1.1) },
  toFilter: (e) => ((e.amount as number) !== 1 ? `brightness(${e.amount})` : ''),
  param: { key: 'amount', min: 0, max: 3 },
})
registerEffectType({
  type: 'contrast',
  shape: { amount: z.number().min(0).max(4).default(1.1) },
  toFilter: (e) => ((e.amount as number) !== 1 ? `contrast(${e.amount})` : ''),
  param: { key: 'amount', min: 0, max: 3 },
})
registerEffectType({
  type: 'saturate',
  shape: { amount: z.number().min(0).max(4).default(1.25) },
  toFilter: (e) => ((e.amount as number) !== 1 ? `saturate(${e.amount})` : ''),
  param: { key: 'amount', min: 0, max: 3 },
})
registerEffectType({
  type: 'grayscale',
  shape: amount01(1),
  toFilter: (e) => ((e.amount as number) > 0 ? `grayscale(${e.amount})` : ''),
  param: { key: 'amount', min: 0, max: 1 },
})
registerEffectType({
  type: 'sepia',
  shape: amount01(1),
  toFilter: (e) => ((e.amount as number) > 0 ? `sepia(${e.amount})` : ''),
  param: { key: 'amount', min: 0, max: 1 },
})
registerEffectType({
  type: 'hue-rotate',
  shape: { degrees: z.number().min(-360).max(360).default(90) },
  toFilter: (e) => ((e.degrees as number) !== 0 ? `hue-rotate(${e.degrees}deg)` : ''),
  param: { key: 'degrees', min: -180, max: 180, unit: '°' },
})
registerEffectType({
  type: 'invert',
  shape: amount01(1),
  toFilter: (e) => ((e.amount as number) > 0 ? `invert(${e.amount})` : ''),
  param: { key: 'amount', min: 0, max: 1 },
})
registerEffectType({
  type: 'drop-shadow',
  shape: {
    offsetX: z.number().default(0),
    offsetY: z.number().default(8),
    blur: z.number().min(0).max(100).default(16),
    color: z.string().default('rgba(0, 0, 0, 0.6)'),
  },
  toFilter: (e) => `drop-shadow(${e.offsetX}px ${e.offsetY}px ${e.blur}px ${e.color})`,
  param: { key: 'blur', min: 0, max: 100, unit: 'px' },
})
registerEffectType({
  type: 'css',
  shape: { filter: z.string().min(1) },
  toFilter: (e) => e.filter as string,
})

/** Built-in + custom effect type names (registration order). */
export const EFFECT_TYPES = {
  get current(): string[] {
    return listEffectTypes().map((e) => e.type)
  },
}.current
// Deprecated snapshot above for compat; prefer listEffectTypes().

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
