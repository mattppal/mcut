import { describe, expect, test } from 'bun:test'
import { compare, measureFile, type MetricId } from './measure'

const count = (metric: MetricId, ...lines: string[]): number =>
  measureFile('packages/x/src/a.ts', lines.join('\n')).get(metric) ?? 0

function areaCode(area: string, entries: readonly (readonly [MetricId, number])[]) {
  const counts = new Map<MetricId, number>(entries)
  const empty = (): Map<MetricId, number> => new Map()
  const buckets = { code: counts, tests: empty(), prose: empty() }
  return {
    perArea: new Map([
      [area, { counts: buckets, fileCount: { code: 1, tests: 0, prose: 0 } }],
    ]),
    totals: buckets,
    perFile: [],
  }
}

describe('measureFile comment lines', () => {
  test('a // inside a string or a URL does not count', () => {
    expect(count('commentLines', "const s = 'a // b'", 'const url = "https://example.com/a"')).toBe(0)
    expect(count('commentLines', 'const s = "x" // note')).toBe(1)
  })

  test('a directive does not count, but is still tallied as a directive', () => {
    expect(count('commentLines', '// eslint-disable-next-line no-console', 'console.log(1)')).toBe(0)
    expect(count('eslintDisable', '// eslint-disable-next-line no-console', 'console.log(1)')).toBe(1)
    expect(count('commentLines', '// @ts-expect-error legacy', 'run()')).toBe(0)
    expect(count('tsSuppress', '// @ts-expect-error legacy', 'run()')).toBe(1)
    expect(count('commentLines', '#!/usr/bin/env bun', 'run()')).toBe(0)
  })

  test('block and JSDoc comments count per line', () => {
    expect(count('commentLines', '/**', ' * Adds.', ' */', 'export const add = 1')).toBe(3)
    expect(count('jsdocLines', '/**', ' * Adds.', ' */', 'export const add = 1')).toBe(3)
    expect(count('jsdocLines', '/* plain', ' block */', 'export const add = 1')).toBe(0)
  })
})

describe('measureFile type escapes', () => {
  test('as const and import aliases are not casts', () => {
    expect(count('asCast', 'const ids = ["a", "b"] as const')).toBe(0)
    expect(count('asCast', 'import { a as b } from "./x"')).toBe(0)
    expect(count('asCast', 'const n = value as number')).toBe(1)
    expect(count('asUnknownAs', 'const n = value as unknown as number')).toBe(1)
  })

  test('x!.y counts as nonNull while a != b does not', () => {
    expect(count('nonNull', 'const v = x!.y')).toBe(1)
    expect(count('nonNull', 'if (a != b) run()')).toBe(0)
    expect(count('nonNull', 'if (a !== b) run()')).toBe(0)
  })

  test('any in a type position counts', () => {
    expect(count('anyType', 'const x = 1 as any')).toBe(1)
    expect(count('anyType', 'function f(a: any): void {}')).toBe(1)
    expect(count('anyType', 'const anyValue = many()')).toBe(0)
  })
})

describe('measureFile structure', () => {
  test('an empty catch counts as emptyCatch', () => {
    expect(count('emptyCatch', 'try {', '  run()', '} catch {}')).toBe(1)
    expect(count('emptyCatch', 'try {', '  run()', '} catch (error) {', '  return null', '}')).toBe(1)
    expect(count('emptyCatch', 'try {', '  run()', '} catch (error) {', '  report(error)', '}')).toBe(0)
  })

  test('console calls are exempt in scripts, tools, and tests', () => {
    const line = 'console.log("hi")'
    expect(measureFile('packages/x/src/a.ts', line).get('consoleLog')).toBe(1)
    expect(measureFile('scripts/a.ts', line).get('consoleLog')).toBe(0)
    expect(measureFile('skills/x/tools/a.ts', line).get('consoleLog')).toBe(0)
    expect(measureFile('packages/x/src/a.test.ts', line).get('consoleLog')).toBe(0)
  })

  test('prose counts dashes and colon connectors only', () => {
    const counts = measureFile('packages/x/README.md', ['# Title', 'Use it: it works', 'A \u2014 B', ''].join('\n'))
    expect(counts.get('colonConnector')).toBe(1)
    expect(counts.get('longDash')).toBe(1)
    expect(counts.get('commentLines')).toBe(0)
  })
})

describe('compare census metrics', () => {
  test('switchStmt growth in the same area yields no growth', () => {
    const base = areaCode('packages', [['switchStmt', 1]])
    const head = areaCode('packages', [['switchStmt', 2]])
    expect(compare(base, head)).toEqual({ kind: 'clean' })
  })
})

describe('effect home', () => {
  test('an effect under packages/react/src/sync is not counted', () => {
    const src = "useEffect(() => sync(), [])\n"
    expect(measureFile('packages/react/src/sync/use-window-event.ts', src).get('useEffect') ?? 0).toBe(0)
    expect(measureFile('apps/studio/registry/mcut/editor-shell.tsx', src).get('useEffect') ?? 0).toBe(1)
  })
})
