import { describe, expect, test } from 'bun:test'
import { elementSupportsProperty, getStaticValue, resolveAnimatedElement } from './keyframes'
// Value import: loading model.ts registers the built-in element types
// (a type-only import would skip registration and empty the keyframeable list).
import { type TextElement } from './model'
import './model'

const textElement = (overrides: Partial<TextElement> = {}): TextElement =>
  ({
    id: 'e-t',
    type: 'text',
    text: 'Title',
    style: {
      fontFamily: 'sans-serif',
      fontSize: 64,
      fontWeight: 600,
      fontStyle: 'normal',
      color: '#fff',
      align: 'center',
      letterSpacing: 2,
      lineHeight: 1.25,
      textTransform: 'none',
    },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    startMs: 0,
    durationMs: 2000,
    ...overrides,
  }) as TextElement

describe('letterSpacing keyframes', () => {
  test('text elements support the property; video does not', () => {
    expect(elementSupportsProperty(textElement(), 'letterSpacing')).toBe(true)
    expect(getStaticValue(textElement(), 'letterSpacing')).toBe(2)
  })

  test('resolveAnimatedElement writes the interpolated tracking into style', () => {
    const element = textElement({
      keyframes: {
        letterSpacing: [
          { timeMs: 0, value: 0 },
          { timeMs: 1000, value: 40 },
        ],
      },
    })
    expect(resolveAnimatedElement(element, 500).style.letterSpacing).toBe(20)
    expect(resolveAnimatedElement(element, 1000).style.letterSpacing).toBe(40)
    // The original element is untouched (resolution is copy-on-write).
    expect(element.style.letterSpacing).toBe(2)
  })
})
