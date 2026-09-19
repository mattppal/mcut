import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { run, tryRun } from '../lib/exec'

export const repoRoot = resolve(import.meta.dirname, '..', '..')

const metricIds = [
  'loc', 'commentLines', 'jsdocLines', 'useEffect', 'useRefState', 'useStateBool',
  'asCast', 'asUnknownAs', 'anyType', 'nonNull', 'tsSuppress', 'eslintDisable',
  'recordUnknown', 'consoleLog', 'todo', 'elseIf', 'switchStmt', 'longFile',
  'longDash', 'colonConnector', 'optionalProps', 'emptyCatch',
] as const

export type MetricId = (typeof metricIds)[number]
type Counts = Map<MetricId, number>
type Bucket = 'code' | 'tests' | 'prose'

const buckets: readonly Bucket[] = ['code', 'tests', 'prose']

const metricDefinitions: Record<MetricId, string> = {
  loc: 'Lines of code',
  commentLines: 'Comment lines (// and /* */, incl. JSDoc)',
  jsdocLines: 'JSDoc block lines',
  useEffect: 'useEffect / useLayoutEffect calls',
  useRefState: 'useRef used as mutable state (`.current =`)',
  useStateBool: 'useState<boolean> or useState(true|false)',
  asCast: '`as X` casts excluding `as const` and import/export aliases',
  asUnknownAs: '`as unknown as` double casts',
  anyType: '`any` type uses',
  nonNull: 'non-null assertions `x!`',
  tsSuppress: '@ts-ignore / @ts-expect-error',
  eslintDisable: 'eslint-disable directives',
  recordUnknown: 'Record<string, unknown|any>',
  consoleLog: 'console.log/warn/error/info/debug in source excluding scripts, tools, and tests',
  todo: 'TODO FIXME HACK XXX',
  elseIf: '`else if` chains',
  switchStmt: 'switch statements',
  longFile: 'files over 400 lines',
  longDash: 'em or en dash characters in code and prose',
  colonConnector: 'prose lines with a mid-sentence colon connector, heuristic `^[^#\\-*|>`].*\\w: [a-z]`',
  optionalProps: 'optional fields `x?:` in type bodies',
  emptyCatch: '`catch` blocks whose body is empty or only `return null`/`return undefined`',
}

interface Ban { metric: MetricId; bucket: Bucket }

const bans: readonly Ban[] = [
  { metric: 'anyType', bucket: 'code' },
  { metric: 'tsSuppress', bucket: 'code' },
  { metric: 'todo', bucket: 'code' },
]

const censusOnly: readonly MetricId[] = ['loc', 'switchStmt', 'optionalProps']
const effectHome = '/packages/react/src/sync/'

interface Area { name: string; roots: readonly string[] }

const areas: readonly Area[] = [
  { name: 'packages', roots: ['packages'] },
  { name: 'apps/studio', roots: ['apps/studio'] },
  { name: 'apps/web', roots: ['apps/web'] },
  { name: 'apps/desktop', roots: ['apps/desktop'] },
  { name: 'skills+scripts+examples', roots: ['skills', 'scripts', 'examples'] },
]

const skipDirs = new Set(['node_modules', 'dist', '.next', 'out', 'public', 'reference'])
const skipPathParts = ['components/ui/', 'components/kibo-ui/', 'content/docs/sdk/reference/']
const codeExtensions = new Set(['.ts', '.tsx', '.mjs', '.js'])
const proseExtensions = new Set(['.md', '.mdx'])
const topOffenders = 12
const topGrownFiles = 5

interface FileMeasure { area: string; file: string; bucket: Bucket; counts: Counts }
interface AreaCounts { counts: Record<Bucket, Counts>; fileCount: Record<Bucket, number> }
interface Measurement {
  perArea: Map<string, AreaCounts>
  totals: Record<Bucket, Counts>
  perFile: FileMeasure[]
}

interface FileDelta { file: string; base: number; head: number }
interface Finding { area: string; bucket: Bucket; metric: MetricId; base: number; head: number; files: FileDelta[] }
type Outcome = { kind: 'clean' } | { kind: 'regressed'; growths: Finding[]; banHits: Finding[] }

const zeroCounts = (): Counts => new Map(metricIds.map((id): [MetricId, number] => [id, 0]))

const add = (counts: Counts, id: MetricId, amount: number): void => {
  counts.set(id, (counts.get(id) ?? 0) + amount)
}

const emptyBucketCounts = (): Record<Bucket, Counts> => ({
  code: zeroCounts(),
  tests: zeroCounts(),
  prose: zeroCounts(),
})

function isSkipped(rel: string): boolean {
  const directories = rel.split('/').slice(0, -1)
  return directories.some((name) => skipDirs.has(name)) || skipPathParts.some((part) => rel.includes(part))
}

export function listFiles(root: string, paths: readonly string[]): string[] {
  const output = run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths], {
    cwd: root,
  })
  return output
    .split('\0')
    .filter((rel) => rel.length > 0 && !isSkipped(rel) && existsSync(join(root, rel)))
    .sort()
}

function bucketOf(rel: string): Bucket | undefined {
  const extension = extname(rel)
  if (proseExtensions.has(extension)) return 'prose'
  if (!codeExtensions.has(extension)) return undefined
  return /\.(test|spec)\.tsx?$/.test(rel) || rel.includes('/e2e/') ? 'tests' : 'code'
}

const stripStrings = (line: string): string => line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
const dashes = (line: string): number => (line.match(/[\u2014\u2013]/g) ?? []).length
const directivePrefixes = ['eslint-', '@ts-', 'prettier-ignore']
const isDirective = (body: string): boolean => {
  const text = body.trimStart()
  return directivePrefixes.some((prefix) => text.startsWith(prefix))
}

function countMarkers(counts: Counts, body: string): void {
  if (/@ts-(ignore|expect-error)/.test(body)) add(counts, 'tsSuppress', 1)
  if (/eslint-disable/.test(body)) add(counts, 'eslintDisable', 1)
  if (/\b(TODO|FIXME|HACK|XXX)\b/.test(body)) add(counts, 'todo', 1)
}

function countComment(counts: Counts, body: string, jsdoc: boolean): void {
  countMarkers(counts, body)
  if (isDirective(body)) return
  add(counts, 'commentLines', 1)
  if (jsdoc) add(counts, 'jsdocLines', 1)
}

export function measureFile(rel: string, text: string): Counts {
  const counts = zeroCounts()
  const lines = text.split('\n')
  add(counts, 'loc', lines.length)
  const bucket = bucketOf(rel)
  if (bucket === 'prose') {
    for (const raw of lines) {
      add(counts, 'longDash', dashes(raw))
      if (/^[^#\-*|>`].*\w: [a-z]/.test(raw.trim())) add(counts, 'colonConnector', 1)
    }
    return counts
  }
  const path = `/${rel}`
  const consoleExempt = path.includes('/scripts/') || path.includes('/tools/') || bucket === 'tests'
  const effectExempt = path.includes(effectHome)
  if (lines.length > 400) add(counts, 'longFile', 1)
  const codeLines: string[] = []
  let block: 'none' | 'comment' | 'jsdoc' = 'none'
  for (const raw of lines) {
    const line = raw.trim()
    add(counts, 'longDash', dashes(raw))
    if (block !== 'none') {
      add(counts, 'commentLines', 1)
      if (block === 'jsdoc') add(counts, 'jsdocLines', 1)
      if (line.includes('*/')) block = 'none'
      continue
    }
    if (line.startsWith('#!')) continue
    if (line.startsWith('/*')) {
      const jsdoc = line.startsWith('/**')
      countComment(counts, line.slice(jsdoc ? 3 : 2), jsdoc)
      if (!line.includes('*/')) block = jsdoc ? 'jsdoc' : 'comment'
      continue
    }
    if (line.startsWith('//')) {
      countComment(counts, line.slice(2), false)
      continue
    }
    const stripped = stripStrings(raw)
    codeLines.push(stripped)
    const trailing = /\/\/(?!\/)(.*)$/.exec(stripped.replace(/https?:\/\/\S*/g, ''))
    if (trailing) countComment(counts, trailing[1] ?? '', false)
    if (!effectExempt && /\buse(Layout)?Effect\s*\(/.test(stripped)) add(counts, 'useEffect', 1)
    if (/\w+Ref\.current\s*=[^=]/.test(stripped)) add(counts, 'useRefState', 1)
    const booleanState = /useState<\s*boolean\s*>/.test(stripped) || /useState\(\s*(true|false)\s*\)/.test(stripped)
    if (booleanState) add(counts, 'useStateBool', 1)
    const importAlias = /^\s*(import|export)\b/.test(stripped) || /^\s*[\w$]+\s+as\s+[\w$]+,?\s*$/.test(stripped)
    if (!importAlias) add(counts, 'asCast', (stripped.match(/\bas\s+(?!const\b)[A-Za-z_{(\[<]/g) ?? []).length)
    add(counts, 'asUnknownAs', (stripped.match(/\bas\s+unknown\s+as\b/g) ?? []).length)
    const anyContext = /[:<,(]\s*any\b|as\s+any\b|any\[\]/.test(stripped)
    if (anyContext) add(counts, 'anyType', (stripped.match(/(?<![\w$])any\b(?!\s*[:(=])/g) ?? []).length)
    add(counts, 'nonNull', (stripped.match(/[\w\])]!(?=[.\[;,)\s]|$)/g) ?? []).length)
    if (/Record<string,\s*(unknown|any)>/.test(stripped)) add(counts, 'recordUnknown', 1)
    if (!consoleExempt && /\bconsole\.(log|warn|error|info|debug)\(/.test(stripped)) add(counts, 'consoleLog', 1)
    if (/\belse\s+if\b/.test(stripped)) add(counts, 'elseIf', 1)
    if (/\bswitch\s*\(/.test(stripped)) add(counts, 'switchStmt', 1)
    if (/^\s*(readonly\s+)?[A-Za-z_$][\w$]*\?\s*:/.test(raw)) add(counts, 'optionalProps', 1)
  }
  const catches = codeLines.join('\n').match(/\bcatch\b(\s*\([^)]*\))?\s*\{\s*(return\s+(null|undefined)\s*;?\s*)?\}/g)
  add(counts, 'emptyCatch', (catches ?? []).length)
  return counts
}

function measureTree(root: string): Measurement {
  const perArea = new Map<string, AreaCounts>()
  const totals = emptyBucketCounts()
  const perFile: FileMeasure[] = []
  for (const area of areas) {
    const areaCounts: AreaCounts = { counts: emptyBucketCounts(), fileCount: { code: 0, tests: 0, prose: 0 } }
    for (const rel of listFiles(root, area.roots)) {
      const bucket = bucketOf(rel)
      if (bucket === undefined) continue
      const counts = measureFile(rel, readFileSync(join(root, rel), 'utf8'))
      areaCounts.fileCount[bucket] += 1
      for (const [id, amount] of counts) {
        add(areaCounts.counts[bucket], id, amount)
        add(totals[bucket], id, amount)
      }
      perFile.push({ area: area.name, file: rel, bucket, counts })
    }
    perArea.set(area.name, areaCounts)
  }
  return { perArea, totals, perFile }
}

function grownFiles(base: Measurement | undefined, head: Measurement, finding: Omit<Finding, 'files'>): FileDelta[] {
  const select = (measurement: Measurement): Map<string, number> =>
    new Map(
      measurement.perFile
        .filter((file) => file.area === finding.area && file.bucket === finding.bucket)
        .map((file): [string, number] => [file.file, file.counts.get(finding.metric) ?? 0]),
    )
  const before = base === undefined ? new Map<string, number>() : select(base)
  return [...select(head)]
    .map(([file, count]): FileDelta => ({ file, base: before.get(file) ?? 0, head: count }))
    .filter((delta) => delta.head > delta.base)
    .sort((a, b) => b.head - b.base - (a.head - a.base) || a.file.localeCompare(b.file))
    .slice(0, topGrownFiles)
}

export function compare(base: Measurement, head: Measurement): Outcome {
  const growths: Finding[] = []
  const banHits: Finding[] = []
  for (const [area, headArea] of head.perArea) {
    const baseArea = base.perArea.get(area)
    for (const bucket of buckets) {
      for (const metric of metricIds) {
        if (censusOnly.includes(metric)) continue
        const before = baseArea?.counts[bucket].get(metric) ?? 0
        const after = headArea.counts[bucket].get(metric) ?? 0
        const finding = { area, bucket, metric, base: before, head: after }
        if (after > before) growths.push({ ...finding, files: grownFiles(base, head, finding) })
        const banned = bans.some((ban) => ban.metric === metric && ban.bucket === bucket)
        if (banned && after > 0) banHits.push({ ...finding, files: grownFiles(undefined, head, finding) })
      }
    }
  }
  if (growths.length === 0 && banHits.length === 0) return { kind: 'clean' }
  return { kind: 'regressed', growths, banHits }
}

const table = (header: string[], rows: string[][]): string =>
  [header, header.map(() => '---'), ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n')

const bucketColumns: Record<Bucket, readonly MetricId[]> = {
  code: metricIds.filter((id) => id !== 'colonConnector'),
  tests: metricIds.filter((id) => id !== 'colonConnector'),
  prose: ['loc', 'longDash', 'colonConnector'],
}

function renderReport(measurement: Measurement): string {
  const sections = ['# Standards measurement']
  for (const bucket of buckets) {
    const columns = bucketColumns[bucket]
    const rows = [...measurement.perArea].map(([area, areaCounts]) => [
      area,
      String(areaCounts.fileCount[bucket]),
      ...columns.map((id) => String(areaCounts.counts[bucket].get(id) ?? 0)),
    ])
    const files = [...measurement.perArea.values()].reduce((sum, area) => sum + area.fileCount[bucket], 0)
    rows.push(['TOTAL', String(files), ...columns.map((id) => String(measurement.totals[bucket].get(id) ?? 0))])
    sections.push(`## Per area, ${bucket}`, table(['area', 'files', ...columns], rows))
  }
  sections.push('## Top offenders per metric')
  for (const metric of metricIds) {
    const rows = measurement.perFile
      .filter((file) => (file.counts.get(metric) ?? 0) > 0)
      .sort((a, b) => (b.counts.get(metric) ?? 0) - (a.counts.get(metric) ?? 0) || a.file.localeCompare(b.file))
      .slice(0, topOffenders)
      .map((file) => [file.file, file.bucket, String(file.counts.get(metric)), String(file.counts.get('loc'))])
    if (rows.length === 0) continue
    sections.push(`### ${metric}. ${metricDefinitions[metric]}`, table(['file', 'bucket', metric, 'loc'], rows))
  }
  return `${sections.join('\n\n')}\n`
}

function toJson(measurement: Measurement) {
  const plain = (counts: Counts) => Object.fromEntries(counts)
  const bucketJson = (counts: Record<Bucket, Counts>) => ({
    code: plain(counts.code),
    tests: plain(counts.tests),
    prose: plain(counts.prose),
  })
  return {
    perArea: Object.fromEntries(
      [...measurement.perArea].map(([area, areaCounts]) => [
        area,
        { ...bucketJson(areaCounts.counts), fileCount: areaCounts.fileCount },
      ]),
    ),
    totals: bucketJson(measurement.totals),
    perFile: measurement.perFile.map((file) => ({
      area: file.area,
      file: file.file,
      bucket: file.bucket,
      ...plain(file.counts),
    })),
  }
}

async function measureMergeBase(ref: string): Promise<Measurement> {
  const mergeBase = run(['git', 'merge-base', 'HEAD', ref], { cwd: repoRoot }).trim()
  console.log(`Comparing HEAD with merge base ${mergeBase.slice(0, 12)} of HEAD and ${ref}`)
  const tempRoot = await mkdtemp(join(tmpdir(), 'mcut-standards-'))
  const baseTree = join(tempRoot, 'base')
  try {
    run(['git', 'worktree', 'add', '--detach', baseTree, mergeBase], { cwd: repoRoot })
    return measureTree(baseTree)
  } finally {
    tryRun(['git', 'worktree', 'remove', '--force', baseTree], { cwd: repoRoot })
    await rm(tempRoot, { recursive: true, force: true })
  }
}

const formatGrowth = (finding: Finding): string =>
  [
    `growth ${finding.area}/${finding.bucket} ${finding.metric} ${finding.base} -> ${finding.head}`,
    ...finding.files.map((delta) => `  ${delta.file} ${delta.base} -> ${delta.head}`),
  ].join('\n')

const formatBan = (finding: Finding): string =>
  [
    `ban ${finding.area}/${finding.bucket} ${finding.metric} ${finding.head}`,
    ...finding.files.map((delta) => `  ${delta.file} ${delta.head}`),
  ].join('\n')

function optionValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

const resolves = (ref: string): boolean =>
  tryRun(['git', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoRoot }).success

async function main(argv: readonly string[]): Promise<number> {
  const baseRef = optionValue(argv, '--base')
  if (baseRef !== undefined && !resolves(baseRef)) {
    console.error(`Cannot resolve ${baseRef}. Run git fetch origin main and retry.`)
    return 1
  }
  const quiet = argv.includes('--quiet')
  const head = measureTree(repoRoot)
  if (!quiet) process.stdout.write(renderReport(head))
  const jsonPath = optionValue(argv, '--json')
  if (jsonPath !== undefined) await writeFile(jsonPath, JSON.stringify(toJson(head), null, 2))
  if (baseRef === undefined) return 0
  const outcome = compare(await measureMergeBase(baseRef), head)
  if (outcome.kind === 'clean') {
    console.log('no growth')
    return 0
  }
  for (const growth of outcome.growths) console.log(formatGrowth(growth))
  for (const hit of outcome.banHits) console.log(formatBan(hit))
  return 1
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
