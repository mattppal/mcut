import { describe, expect, test } from 'bun:test'
import { valueAt } from './value-at'

describe('valueAt', () => {
  test('returns the element at an in-range index', () => {
    expect(valueAt([10, 20, 30], 0)).toBe(10)
    expect(valueAt([10, 20, 30], 2)).toBe(30)
    expect(valueAt(new Float32Array([0.5, -0.25]), 1)).toBe(-0.25)
    expect(valueAt([{ timeMs: 40 }], 0)).toEqual({ timeMs: 40 })
  })

  test('throws a RangeError naming the index and length when out of range', () => {
    expect(() => valueAt([10, 20, 30], 3)).toThrow(new RangeError('Index 3 is out of range for a list of length 3'))
    expect(() => valueAt([10, 20, 30], -1)).toThrow(new RangeError('Index -1 is out of range for a list of length 3'))
    expect(() => valueAt(new Float32Array(0), 0)).toThrow(new RangeError('Index 0 is out of range for a list of length 0'))
  })
})
