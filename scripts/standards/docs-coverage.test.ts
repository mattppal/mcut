import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coverPackages, formatFindings, listExports, listHeadings } from './docs-coverage'

const root = mkdtempSync(join(tmpdir(), 'docs-coverage-'))
const packagesRoot = join(root, 'packages')
const docsRoot = join(root, 'docs', 'sdk')

function writeFile(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

const fakeIndex = [
  "export { alpha, beta as gamma, type Delta } from './model'",
  "export * from './helpers'",
  'export function epsilon(): void {}',
  'export const zeta = 1',
  'export interface Eta { id: string }',
  'export type Theta = string',
  'export class Iota {}',
  'const hidden = 2',
  'export default hidden',
  '',
].join('\n')

const fakeHelpers = [
  'export const kappa = 1',
  "export { lambda } from './deep'",
  "export * from './deeper'",
  'const secret = 3',
  '',
].join('\n')

const fakePage = [
  '---',
  'title: "@fake/widget"',
  '---',
  '',
  '## Install',
  '',
  '```sh',
  'bun add @fake/widget',
  '### notAHeading',
  '```',
  '',
  '## Functions',
  '',
  '### alpha',
  '',
  '```ts',
  'function alpha(): void',
  '```',
  '',
  'Does one thing.',
  '',
  '### `gamma`',
  '',
  '### omega',
  '',
].join('\n')

writeFile(join(packagesRoot, 'widget', 'src', 'index.ts'), fakeIndex)
writeFile(join(packagesRoot, 'widget', 'src', 'helpers.ts'), fakeHelpers)
writeFile(join(packagesRoot, 'widget', 'src', 'deep.ts'), 'export const lambda = 2\n')
writeFile(join(packagesRoot, 'widget', 'src', 'deeper.ts'), 'export const mu = 3\n')
writeFile(join(packagesRoot, 'unpaged', 'src', 'index.ts'), 'export const nu = 4\n')
writeFile(join(docsRoot, 'widget.mdx'), fakePage)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listExports', () => {
  test('collects named re-exports under their exported alias, declarations, and one level of export star', () => {
    expect(listExports(join(packagesRoot, 'widget', 'src', 'index.ts'))).toEqual([
      'Delta',
      'Eta',
      'Iota',
      'Theta',
      'alpha',
      'epsilon',
      'gamma',
      'kappa',
      'lambda',
      'zeta',
    ])
  })
})

describe('listHeadings', () => {
  test('reads level three headings outside fences and strips a code span', () => {
    expect(listHeadings(fakePage)).toEqual(['alpha', 'gamma', 'omega'])
  })
})

describe('coverPackages', () => {
  const coverage = coverPackages(packagesRoot, docsRoot)

  test('skips a package without a page', () => {
    expect(coverage.map((entry) => entry.name)).toEqual(['widget'])
  })

  test('reports an export without a heading and a heading without an export', () => {
    expect(formatFindings(coverage)).toEqual([
      'widget: export Delta has no heading',
      'widget: export Eta has no heading',
      'widget: export Iota has no heading',
      'widget: export Theta has no heading',
      'widget: export epsilon has no heading',
      'widget: export kappa has no heading',
      'widget: export lambda has no heading',
      'widget: export zeta has no heading',
      'widget: heading omega in widget.mdx names no export',
    ])
  })

  test('a page that documents every export and nothing else is clean', () => {
    const clean = ['alpha', 'gamma', 'Delta', 'Eta', 'Iota', 'Theta', 'epsilon', 'kappa', 'lambda', 'zeta']
      .map((name) => `### ${name}\n`)
      .join('\n')
    writeFileSync(join(docsRoot, 'widget.mdx'), clean)
    expect(formatFindings(coverPackages(packagesRoot, docsRoot))).toEqual([])
  })
})
