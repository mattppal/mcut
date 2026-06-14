import { describe, expect, test } from 'bun:test'
import { buildFont, layoutTextBlock, type MeasureFn } from './text'

const measure: MeasureFn = (text) => text.length * 10

const style = {
  fontFamily: 'sans-serif',
  fontSize: 10,
  fontWeight: 600,
  fontStyle: 'normal',
  color: '#fff',
  align: 'center',
  letterSpacing: 0,
  lineHeight: 1.25,
  textTransform: 'none',
} as const

describe('layoutTextBlock', () => {
  test('keeps legacy measured-content layout without a box', () => {
    const layout = layoutTextBlock(measure, 'hello world', style)
    expect(layout.lines.map((line) => line.text)).toEqual(['hello world'])
    expect(layout.width).toBe(110)
    expect(layout.height).toBe(12.5)
    expect(layout.overflow).toBeNull()
  })

  test('wraps text inside a durable box width', () => {
    const layout = layoutTextBlock(measure, 'hello world', style, {
      box: { width: 60, overflow: 'clip' },
    })
    expect(layout.lines.map((line) => line.text)).toEqual(['hello', 'world'])
    expect(layout.width).toBe(60)
    expect(layout.height).toBe(25)
    expect(layout.overflow).toBe('clip')
  })

  test('applies the case transform before measuring and wrapping', () => {
    const layout = layoutTextBlock(measure, 'shout this', { ...style, textTransform: 'uppercase' })
    expect(layout.lines.map((line) => line.text)).toEqual(['SHOUT THIS'])
  })

  test('uses the lineHeight multiplier', () => {
    const layout = layoutTextBlock(measure, 'one\ntwo', { ...style, lineHeight: 2 })
    expect(layout.lineHeight).toBe(20)
    expect(layout.height).toBe(40)
  })

  test('passes letterSpacing through to the measure function', () => {
    const seen: Array<number | undefined> = []
    const spy: MeasureFn = (text, _font, letterSpacingPx) => {
      seen.push(letterSpacingPx)
      return text.length * 10
    }
    layoutTextBlock(spy, 'hello', { ...style, letterSpacing: 3 })
    expect(seen).toEqual([3])
  })
})

describe('buildFont', () => {
  test('quotes concrete family names, leaves generics and stacks alone', () => {
    expect(buildFont({ fontWeight: 400, fontSize: 64, fontFamily: 'Bebas Neue' })).toBe(
      '400 64px "Bebas Neue"',
    )
    expect(buildFont({ fontWeight: 600, fontSize: 10, fontFamily: 'sans-serif' })).toBe(
      '600 10px sans-serif',
    )
    expect(buildFont({ fontWeight: 600, fontSize: 10, fontFamily: 'Arial, sans-serif' })).toBe(
      '600 10px Arial, sans-serif',
    )
    expect(
      buildFont({ fontStyle: 'italic', fontWeight: 700, fontSize: 32, fontFamily: 'Inter' }),
    ).toBe('italic 700 32px "Inter"')
  })
})
