import { assertNever, type CurvePoint, type Effect } from '@mcut/timeline'
import { parseCssColor } from './color'

/**
 * Compile an element's effect stack into the GPU pass plan, preserving
 * stack order (CSS filter semantics: left to right — blur-then-brightness
 * is not brightness-then-blur). Consecutive color-space effects fuse into
 * ONE fragment pass that loops an ordered op list; blur, drop-shadow, and
 * 3D LUTs become their own passes. `css` (raw CSS filter strings) cannot
 * run on GPU — those layers fall back to the canvas2d raster path.
 */

/** Op kinds, mirrored in COLOR_SHADER — keep the numbering in sync. */
export const COLOR_OP = {
  brightness: 1,
  contrast: 2,
  saturate: 3,
  grayscale: 4,
  sepia: 5,
  hueRotate: 6,
  invert: 7,
  chromaKey: 8,
  curves: 9,
} as const

export interface ColorOp {
  kind: number
  /** Up to 8 packed params, op-specific (vec4 a + vec4 b in the shader). */
  params: number[]
}

export type EffectPass =
  | {
      kind: 'color'
      ops: ColorOp[]
      /** Per-channel 256-entry LUTs when a curves op is in this run. */
      curves: { r: Float32Array; g: Float32Array; b: Float32Array } | null
    }
  | { kind: 'blur'; radius: number }
  | { kind: 'shadow'; offsetX: number; offsetY: number; blur: number; color: [number, number, number, number] }
  | { kind: 'lut3d'; lutId: string; intensity: number }

export interface EffectPlan {
  passes: EffectPass[]
  /** The stack contains effects only canvas2d can run (`css`/unknown). */
  unsupported: boolean
}

/** Shader-side cap: ops per fused color pass (matches the WGSL array size). */
const MAX_COLOR_OPS = 16

const params = (...values: number[]): number[] => values

/** Monotone-x piecewise-linear curve → 256-entry LUT (identity when empty). */
export function curveToLut(points: readonly CurvePoint[] | undefined): Float32Array {
  const lut = new Float32Array(256)
  const [first, ...rest] = [...(points ?? [])].sort((a, b) => a.x - b.x)
  if (!first) {
    for (let i = 0; i < 256; i++) lut[i] = i / 255
    return lut
  }
  const sample = (x: number): number => {
    if (first.x >= x) return first.y
    let a = first
    for (const b of rest) {
      if (b.x >= x) {
        const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
        return a.y + (b.y - a.y) * t
      }
      a = b
    }
    return a.y
  }
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.min(1, Math.max(0, sample(i / 255)))
  }
  return lut
}

export function planEffects(effects: readonly Effect[] | undefined): EffectPlan {
  const plan: EffectPlan = { passes: [], unsupported: false }
  if (!effects) return plan

  const colorRun = (): Extract<EffectPass, { kind: 'color' }> => {
    const last = plan.passes[plan.passes.length - 1]
    if (last && last.kind === 'color' && last.ops.length < MAX_COLOR_OPS && !last.curves) return last
    const run: Extract<EffectPass, { kind: 'color' }> = { kind: 'color', ops: [], curves: null }
    plan.passes.push(run)
    return run
  }

  for (const effect of effects) {
    if (!effect.enabled) continue
    switch (effect.type) {
      case 'brightness':
        if (effect.amount !== 1) colorRun().ops.push({ kind: COLOR_OP.brightness, params: params(effect.amount) })
        break
      case 'contrast':
        if (effect.amount !== 1) colorRun().ops.push({ kind: COLOR_OP.contrast, params: params(effect.amount) })
        break
      case 'saturate':
        if (effect.amount !== 1) colorRun().ops.push({ kind: COLOR_OP.saturate, params: params(effect.amount) })
        break
      case 'grayscale':
        if (effect.amount > 0) colorRun().ops.push({ kind: COLOR_OP.grayscale, params: params(effect.amount) })
        break
      case 'sepia':
        if (effect.amount > 0) colorRun().ops.push({ kind: COLOR_OP.sepia, params: params(effect.amount) })
        break
      case 'hue-rotate':
        if (effect.degrees !== 0) {
          colorRun().ops.push({ kind: COLOR_OP.hueRotate, params: params((effect.degrees * Math.PI) / 180) })
        }
        break
      case 'invert':
        if (effect.amount > 0) colorRun().ops.push({ kind: COLOR_OP.invert, params: params(effect.amount) })
        break
      case 'blur':
        if (effect.radius > 0) plan.passes.push({ kind: 'blur', radius: effect.radius })
        break
      case 'drop-shadow':
        plan.passes.push({
          kind: 'shadow',
          offsetX: effect.offsetX,
          offsetY: effect.offsetY,
          blur: effect.blur,
          color: parseCssColor(effect.color),
        })
        break
      case 'css':
        plan.unsupported = true
        break
      case 'chroma-key': {
        const key = parseCssColor(effect.keyColor)
        colorRun().ops.push({
          kind: COLOR_OP.chromaKey,
          params: params(
            key[0],
            key[1],
            key[2],
            effect.tolerance,
            effect.softness,
            effect.spillSuppression,
          ),
        })
        break
      }
      case 'curves': {
        const master = curveToLut(effect.rgb)
        const compose = (channel: Float32Array): Float32Array => {
          const out = new Float32Array(256)
          for (let i = 0; i < 256; i++) {
            out[i] = master[Math.round((channel[i] ?? 0) * 255)] ?? 0
          }
          return out
        }
        const run = colorRun()
        run.curves = {
          r: compose(curveToLut(effect.red)),
          g: compose(curveToLut(effect.green)),
          b: compose(curveToLut(effect.blue)),
        }
        run.ops.push({ kind: COLOR_OP.curves, params: params() })
        break
      }
      case 'lut3d':
        plan.passes.push({ kind: 'lut3d', lutId: effect.lutId, intensity: effect.intensity })
        break
      default:
        assertNever(effect)
    }
  }
  return plan
}

/** True when this stack can only render through the canvas2d raster path. */
export function hasUnsupportedEffects(effects: readonly Effect[] | undefined): boolean {
  if (!effects) return false
  return planEffects(effects).unsupported
}
