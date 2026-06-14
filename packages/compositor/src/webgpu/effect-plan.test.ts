import { describe, expect, test } from 'bun:test'
import type { Effect } from '@mcut/timeline'
import { parseCssColor } from './color'
import { COLOR_OP, curveToLut, hasUnsupportedEffects, planEffects } from './effect-plan'
import { gaussianKernel, invertChrome } from './transform'
import '../gpu-effects'

const effect = (record: Record<string, unknown>): Effect =>
  ({ enabled: true, ...record }) as unknown as Effect

describe('parseCssColor', () => {
  test('hex forms', () => {
    expect(parseCssColor('#fff')).toEqual([1, 1, 1, 1])
    expect(parseCssColor('#00ff00')).toEqual([0, 1, 0, 1])
    expect(parseCssColor('#00000080')[3]).toBeCloseTo(128 / 255, 5)
  })

  test('rgb()/rgba()', () => {
    expect(parseCssColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1])
    expect(parseCssColor('rgba(0, 0, 0, 0.6)')[3]).toBeCloseTo(0.6, 5)
  })

  test('names and junk', () => {
    expect(parseCssColor('transparent')).toEqual([0, 0, 0, 0])
    expect(parseCssColor('not-a-color')).toEqual([0, 0, 0, 1])
  })
})

describe('planEffects', () => {
  test('fuses consecutive color effects into one pass, in order', () => {
    const plan = planEffects([
      effect({ type: 'brightness', amount: 1.2 }),
      effect({ type: 'saturate', amount: 0.5 }),
      effect({ type: 'invert', amount: 1 }),
    ])
    expect(plan.passes).toHaveLength(1)
    const pass = plan.passes[0]!
    if (pass.kind !== 'color') throw new Error('expected color pass')
    expect(pass.ops.map((o) => o.kind)).toEqual([
      COLOR_OP.brightness,
      COLOR_OP.saturate,
      COLOR_OP.invert,
    ])
  })

  test('preserves stack order across pass kinds', () => {
    const plan = planEffects([
      effect({ type: 'blur', radius: 10 }),
      effect({ type: 'brightness', amount: 2 }),
      effect({ type: 'drop-shadow', offsetX: 0, offsetY: 8, blur: 16, color: '#000' }),
      effect({ type: 'grayscale', amount: 1 }),
    ])
    expect(plan.passes.map((p) => p.kind)).toEqual(['blur', 'color', 'shadow', 'color'])
  })

  test('skips inert and disabled effects', () => {
    const plan = planEffects([
      effect({ type: 'brightness', amount: 1 }),
      { ...effect({ type: 'invert', amount: 1 }), enabled: false } as Effect,
      effect({ type: 'blur', radius: 0 }),
    ])
    expect(plan.passes).toHaveLength(0)
  })

  test('css filters mark the stack unsupported (raster fallback)', () => {
    expect(hasUnsupportedEffects([effect({ type: 'css', filter: 'url(#goo)' })])).toBe(true)
    expect(hasUnsupportedEffects([effect({ type: 'blur', radius: 4 })])).toBe(false)
  })

  test('chroma key packs key color + tolerances', () => {
    const plan = planEffects([
      effect({ type: 'chroma-key', keyColor: '#00ff00', tolerance: 0.3, softness: 0.2, spillSuppression: 0.7 }),
    ])
    const pass = plan.passes[0]!
    if (pass.kind !== 'color') throw new Error('expected color pass')
    expect(pass.ops[0]!.kind).toBe(COLOR_OP.chromaKey)
    expect(pass.ops[0]!.params.slice(0, 6)).toEqual([0, 1, 0, 0.3, 0.2, 0.7])
  })

  test('curves produce per-channel LUTs with master composed after', () => {
    const plan = planEffects([
      effect({ type: 'curves', rgb: [{ x: 0, y: 1 }, { x: 1, y: 0 }], red: [] }),
    ])
    const pass = plan.passes[0]!
    if (pass.kind !== 'color') throw new Error('expected color pass')
    expect(pass.curves).not.toBeNull()
    // Master inversion applies to the identity red channel.
    expect(pass.curves!.r[0]).toBeCloseTo(1, 5)
    expect(pass.curves!.r[255]).toBeCloseTo(0, 5)
  })

  test('lut3d becomes its own pass', () => {
    const plan = planEffects([effect({ type: 'lut3d', lutId: 'teal-orange', intensity: 0.8 })])
    expect(plan.passes[0]).toEqual({ kind: 'lut3d', lutId: 'teal-orange', intensity: 0.8 })
  })
})

describe('curveToLut', () => {
  test('empty is identity', () => {
    const lut = curveToLut([])
    expect(lut[0]).toBe(0)
    expect(lut[255]).toBe(1)
    expect(lut[128]).toBeCloseTo(128 / 255, 5)
  })

  test('interpolates between points', () => {
    const lut = curveToLut([
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 1 },
    ])
    expect(lut[64]!).toBeCloseTo(0.5, 1)
    expect(lut[200]).toBe(1)
  })
})

describe('invertChrome', () => {
  const chrome = {
    centerX: 100,
    centerY: 50,
    rotationDeg: 0,
    scaleX: 2,
    scaleY: 4,
    opacity: 1,
  }

  test('inverts scale about the center', () => {
    const inv = invertChrome(chrome)
    // Frame point (110, 54) → local (5, 1) under scale (2, 4).
    expect(inv.m00 * 10 + inv.m01 * 4).toBeCloseTo(5, 5)
    expect(inv.m10 * 10 + inv.m11 * 4).toBeCloseTo(1, 5)
  })

  test('inverts rotation', () => {
    const inv = invertChrome({ ...chrome, scaleX: 1, scaleY: 1, rotationDeg: 90 })
    // Forward: local (1, 0) rotates to frame offset (0, 1). Inverse maps back.
    expect(inv.m00 * 0 + inv.m01 * 1).toBeCloseTo(1, 5)
    expect(inv.m10 * 0 + inv.m11 * 1).toBeCloseTo(0, 5)
  })

  test('flags degenerate scale', () => {
    expect(invertChrome({ ...chrome, scaleX: 0 }).degenerate).toBe(true)
  })
})

describe('gaussianKernel', () => {
  test('normalized and symmetric', () => {
    const kernel = gaussianKernel(8)
    const sum = kernel.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
    expect(kernel[0]).toBeCloseTo(kernel[kernel.length - 1]!, 6)
    const mid = (kernel.length - 1) / 2
    expect(kernel[mid]!).toBeGreaterThan(kernel[0]!)
  })

  test('kernel width tracks the radius', () => {
    expect(gaussianKernel(2).length).toBeLessThan(gaussianKernel(20).length)
  })
})
