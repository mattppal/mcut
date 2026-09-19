import { describe, expect, test } from 'bun:test'
import { stripComments } from './strip-comments'

const lines = (...parts: string[]): string => `${parts.join('\n')}\n`

describe('stripComments', () => {
  test('deletes a JSDoc block above an export', () => {
    const source = lines(
      '/**',
      ' * Adds two numbers.',
      ' * @param a first',
      ' */',
      'export const add = (a: number, b: number): number => a + b',
    )
    const result = stripComments(source, 'math.ts')
    expect(result.removed).toBe(1)
    expect(result.text).toBe(lines('export const add = (a: number, b: number): number => a + b'))
  })

  test('keeps a comment that carries an https link', () => {
    const source = lines(
      '// see https://example.com/spec',
      'export const limit = 3',
    )
    expect(stripComments(source, 'limit.ts')).toEqual({ text: source, removed: 0 })
  })

  test('keeps an eslint directive', () => {
    const source = lines(
      '// eslint-disable-next-line no-console',
      'console.log(1)',
    )
    expect(stripComments(source, 'log.ts')).toEqual({ text: source, removed: 0 })
  })

  test('removes trailing comments, whole comment lines, and the blank run they leave', () => {
    const source = lines(
      '#!/usr/bin/env bun',
      'const url = "https://example.com" // trailing',
      '',
      '// first',
      '// second',
      '',
      'const pattern = /\\/\\/ not a comment/',
      'const template = `// not a comment ${url}`',
      'export { url, pattern, template }',
    )
    const result = stripComments(source, 'mixed.ts')
    expect(result.removed).toBe(3)
    expect(result.text).toBe(
      lines(
        '#!/usr/bin/env bun',
        'const url = "https://example.com"',
        '',
        'const pattern = /\\/\\/ not a comment/',
        'const template = `// not a comment ${url}`',
        'export { url, pattern, template }',
      ),
    )
  })

  test('removes a comment-only JSX expression container with its braces', () => {
    const source = lines(
      'export const view = (',
      '  <div>',
      '    {/* label */}',
      '    <span>// text, not a comment</span>',
      '  </div>',
      ')',
    )
    const result = stripComments(source, 'view.tsx')
    expect(result.removed).toBe(1)
    expect(result.text).toBe(
      lines('export const view = (', '  <div>', '    <span>// text, not a comment</span>', '  </div>', ')'),
    )
  })

  test('is idempotent', () => {
    const source = lines('// gone', 'export const a = 1 /* inline */', '/// <reference types="bun" />')
    const once = stripComments(source, 'a.ts')
    expect(once.removed).toBe(2)
    expect(stripComments(once.text, 'a.ts')).toEqual({ text: once.text, removed: 0 })
  })
})
