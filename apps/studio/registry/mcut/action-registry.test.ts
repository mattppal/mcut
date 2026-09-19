import { describe, expect, test } from 'bun:test'
import { matchShortcut } from './action-registry'

const noModifiers = { metaKey: false, ctrlKey: false, shiftKey: false }

describe('matchShortcut', () => {
  test('an alt shortcut matches on the physical key when macOS Option types a special character (⌥K types ˚)', () => {
    expect(matchShortcut({ ...noModifiers, altKey: true, key: '˚', code: 'KeyK' }, { key: 'k', alt: true })).toBe(true)
  })

  test('the physical key does not rescue a shortcut without alt', () => {
    expect(matchShortcut({ ...noModifiers, altKey: false, key: '˚', code: 'KeyK' }, { key: 'k' })).toBe(false)
  })

  test('meta accepts either ⌘ or Ctrl and rejects a missing modifier', () => {
    expect(matchShortcut({ ...noModifiers, altKey: false, key: 'z', metaKey: true }, { key: 'z', meta: true })).toBe(true)
    expect(matchShortcut({ ...noModifiers, altKey: false, key: 'z', ctrlKey: true }, { key: 'z', meta: true })).toBe(true)
    expect(matchShortcut({ ...noModifiers, altKey: false, key: 'z' }, { key: 'z', meta: true })).toBe(false)
  })
})
