import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseManifest, type FixtureManifest, type ManifestFixture, type ManifestMutation } from '../../../scripts/fixtures/manifest'
import { clip, collectErrors, openEditor } from './helpers'
import type { InPageProbe } from './media-fuzz/inpage'
import { knownFailures, matchKnownFailure, type Violation } from './media-fuzz/known-failures'
import { browserFixtures, browserMutations, proprietaryCodecFixtures } from './media-fuzz/subset'

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixturesDir = process.env.MCUT_FIXTURES_DIR ?? path.join(repoRoot, 'fixtures', 'media')
const manifestFile = path.join(fixturesDir, 'manifest.json')
const manifest: FixtureManifest | null = existsSync(manifestFile) ? parseManifest(JSON.parse(readFileSync(manifestFile, 'utf8'))) : null
const onlyFixture = process.env.MCUT_FUZZ_FIXTURE
const known = onlyFixture ? [] : knownFailures
const selected = (id: string) => !onlyFixture || onlyFixture === id

const AUDIO_CANVAS = { width: 320, height: 180 }
const CANVAS_MIN_PX = 2
const ODD_SIZE_SLACK_PX = 1
const EXPORT_TIMEOUT_MS = 120_000

interface Canvas {
  width: number
  height: number
}

let bundle = ''
test.beforeAll(() => {
  bundle = execFileSync('bun', ['build', path.join(__dirname, 'media-fuzz', 'inpage.ts'), '--target', 'browser', '--format', 'iife'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
})

function fixtureById(id: string): ManifestFixture {
  const fixture = manifest?.fixtures.find((entry) => entry.id === id)
  if (!fixture) throw new Error(`fixture ${id} is not in ${manifestFile}, rerun bun run fixtures`)
  return fixture
}

function mutationById(id: string): ManifestMutation {
  const mutation = manifest?.mutations.find((entry) => entry.id === id)
  if (!mutation) throw new Error(`mutation ${id} is not in ${manifestFile}, rerun bun run fixtures`)
  return mutation
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function badgeSeconds(badge: string): number {
  const [minutes = '0', seconds = '0'] = badge.split(':')
  return Number(minutes) * 60 + Number(seconds)
}

function canvasFor(fixture: ManifestFixture): Canvas {
  const { expected } = fixture.recipe
  if (!expected.hasVideo) return AUDIO_CANVAS
  return {
    width: Math.max(CANVAS_MIN_PX, expected.width),
    height: Math.max(CANVAS_MIN_PX, expected.height),
  }
}

async function importFile(page: Page, file: string): Promise<{ card: Locator; toast: Locator }> {
  await page.setInputFiles('input[type="file"]', path.join(fixturesDir, file))
  const card = page.getByTitle(new RegExp(`^${escapeRegExp(file)} `))
  const toast = page.getByText(`Could not import ${file}`)
  await expect(card.or(toast)).toBeVisible({ timeout: 20_000 })
  return { card, toast }
}

async function badgeText(card: Locator): Promise<string> {
  return ((await card.locator('[data-slot="badge"]').textContent()) ?? '').trim()
}

async function setCanvas(page: Page, canvas: Canvas): Promise<void> {
  for (const [label, value] of [
    ['Width', canvas.width],
    ['Height', canvas.height],
  ] as const) {
    const input = page.getByLabel(label, { exact: true })
    await input.fill(String(value))
    await input.press('Enter')
    await expect(input).toHaveValue(String(value))
  }
}

type ExportOutcome = { kind: 'file'; bytes: Buffer } | { kind: 'failed'; detail: string }

async function exportWebm(page: Page): Promise<ExportOutcome> {
  await page.locator('[data-mcut-export-trigger]').click()
  await page.getByRole('button', { name: 'WebM', exact: true }).click()
  const failure = page.getByText(/^Export failed:/)
  const download = page.waitForEvent('download', { timeout: EXPORT_TIMEOUT_MS }).then(
    (value) => ({ kind: 'download' as const, value }),
    () => ({ kind: 'timeout' as const }),
  )
  const failed = failure.waitFor({ timeout: EXPORT_TIMEOUT_MS }).then(
    () => ({ kind: 'failed' as const }),
    () => ({ kind: 'timeout' as const }),
  )
  await page.getByRole('button', { name: 'Export WebM' }).click()
  const first = await Promise.race([download, failed])
  if (first.kind === 'download') return { kind: 'file', bytes: readFileSync(await first.value.path()) }
  if (first.kind === 'failed') return { kind: 'failed', detail: (await failure.textContent()) ?? 'Export failed' }
  return { kind: 'failed', detail: `neither a download nor an export error within ${EXPORT_TIMEOUT_MS} ms` }
}

function probeInPage(page: Page, bytes: Buffer, type: string): Promise<InPageProbe> {
  return page.evaluate(([base64, mime]) => window.__mcutMediaFuzz.probe(base64, mime), [bytes.toString('base64'), type] as const)
}

function describeProbe(probe: InPageProbe): string {
  if (!probe.ok) return `threw ${probe.name} (${probe.message})`
  return `${probe.durationMs}ms ${probe.width ?? '-'}x${probe.height ?? '-'} v=${probe.hasVideo} a=${probe.hasAudio}`
}

function exportViolations(fixture: ManifestFixture, canvas: Canvas, fps: number, probe: InPageProbe): Violation[] {
  if (!probe.ok) {
    return [{ invariant: 'export-probes', detail: `exported webm failed to probe with ${probe.name} (${probe.message})` }]
  }
  const { expected } = fixture.recipe
  const violations: Violation[] = []
  const oneFrameMs = Math.ceil(1000 / fps)
  const slack = expected.tolerance + oneFrameMs
  const drift = Math.abs(probe.durationMs - expected.durationMs)
  if (drift > slack) {
    violations.push({
      invariant: 'export-duration-within-tolerance',
      detail: `exported durationMs ${probe.durationMs} is ${drift} ms from ${expected.durationMs} (tolerance ${expected.tolerance} plus one ${oneFrameMs} ms frame)`,
    })
  }
  if (!probe.hasVideo) violations.push({ invariant: 'export-has-video', detail: 'exported webm has no video track' })
  if (expected.hasAudio && !probe.hasAudio) {
    violations.push({ invariant: 'export-keeps-audio', detail: 'source has audio but the exported webm has none' })
  }
  const allowed = (wanted: number) => (wanted % 2 === 1 ? ODD_SIZE_SLACK_PX : 0)
  const offBy = (actual: number | null, wanted: number) => actual === null || Math.abs(actual - wanted) > allowed(wanted)
  if (offBy(probe.width, canvas.width) || offBy(probe.height, canvas.height)) {
    violations.push({
      invariant: 'export-dimensions-match',
      detail: `exported ${probe.width ?? '-'}x${probe.height ?? '-'}, expected the ${canvas.width}x${canvas.height} canvas (odd sizes may round by ${ODD_SIZE_SLACK_PX} px)`,
    })
  }
  return violations
}

function settle(id: string, violations: readonly Violation[]): void {
  const match = matchKnownFailure(id, violations, known)
  if (violations.length > 0 && !match) {
    throw new Error(
      [
        `media fuzz failed on ${id}`,
        ...violations.map((violation) => `  [${violation.invariant}] ${violation.detail}`),
        `reproduce with MCUT_FUZZ_FIXTURE=${id} bunx playwright test e2e/media-fuzz.spec.ts`,
      ].join('\n'),
    )
  }
  if (match) {
    const tags = violations.map((violation) => violation.invariant).join(' ')
    test.info().annotations.push({ type: 'known-failure', description: `${match.issue} (${tags})` })
  }
  const stale = known.filter((entry) => entry.fixtures.includes(id) && entry !== match).map((entry) => entry.issue)
  expect(stale, `${id} no longer reproduces these issues, remove the rows from e2e/media-fuzz/known-failures.ts`).toEqual([])
}

const fullChrome = Boolean(process.env.MCUT_CHROME_PATH)
const fixtureRows = [
  ...browserFixtures.map((row) => ({ ...row, proprietary: false })),
  ...proprietaryCodecFixtures.map((row) => ({ ...row, proprietary: true })),
]

test.describe('media fuzz', () => {
  test.skip(manifest === null, `no fixture manifest at ${manifestFile}, run bun run fixtures first`)

  for (const row of fixtureRows.filter((entry) => selected(entry.id))) {
    test(`${row.id} imports, exports to webm, and re-probes within tolerance`, async ({ page }) => {
      test.slow()
      test.skip(row.proprietary && !fullChrome, 'needs H.264 and AAC decoders, set MCUT_CHROME_PATH to a full Chrome')
      const fixture = fixtureById(row.id)
      test.skip(fixture.skipped !== null, fixture.skipped ?? '')
      const canvas = canvasFor(fixture)
      const errors = collectErrors(page)
      await openEditor(page)
      await page.addScriptTag({ content: bundle })

      const violations: Violation[] = []
      const { card, toast } = await importFile(page, fixture.file)
      if (await toast.isVisible()) {
        violations.push({ invariant: 'valid-file-imports', detail: `Studio rejected ${fixture.file} (${errors.join(' | ')})` })
        settle(row.id, violations)
        return
      }
      const badge = await badgeText(card)
      if (badge !== row.badge) {
        violations.push({ invariant: 'badge-shows-duration', detail: `badge reads "${badge}", expected "${row.badge}"` })
      }

      await setCanvas(page, canvas)
      const fps = Number(await page.getByLabel('FPS', { exact: true }).inputValue())
      await card.hover()
      await card.getByTitle('Add at playhead').click()
      await expect(clip(page)).toHaveCount(1)

      const outcome = await exportWebm(page)
      if (outcome.kind === 'failed') {
        console.log(`${row.id} badge "${badge}" export failed, ${outcome.detail}`)
        violations.push({ invariant: 'export-completes', detail: outcome.detail })
      } else {
        const probe = await probeInPage(page, outcome.bytes, 'video/webm')
        console.log(`${row.id} badge "${badge}" exported ${outcome.bytes.length} bytes, probe ${describeProbe(probe)}`)
        violations.push(...exportViolations(fixture, canvas, fps, probe))
      }
      if (errors.length > 0) violations.push({ invariant: 'no-page-errors', detail: errors.join(' | ') })
      settle(row.id, violations)
    })
  }

  for (const row of browserMutations.filter((entry) => selected(entry.id))) {
    test(`${row.id} is rejected with a typed error or imports as a partial file`, async ({ page }) => {
      const mutation = mutationById(row.id)
      const source = fixtureById(mutation.sourceId)
      const sourceSeconds = Math.round(source.recipe.expected.durationMs / 1000)
      const errors = collectErrors(page)
      await openEditor(page)

      const violations: Violation[] = []
      const { card, toast } = await importFile(page, mutation.file)
      if (await toast.isVisible()) {
        console.log(`${row.id} rejected, console ${errors.join(' | ') || 'empty'}`)
        const untyped = errors.filter((error) => !error.startsWith('MediaProbeError'))
        if (untyped.length > 0) {
          violations.push({ invariant: 'typed-rejection', detail: `import failed without a MediaProbeError, console shows ${untyped.join(' | ')}` })
        }
        if (row.outcome === 'whole') {
          violations.push({ invariant: 'valid-file-imports', detail: `Studio rejected ${mutation.file}, which only moves moov after mdat` })
        }
      } else {
        const badge = await badgeText(card)
        console.log(`${row.id} imported with badge "${badge}"${errors.length > 0 ? `, console ${errors.join(' | ')}` : ''}`)
        const seconds = badgeSeconds(badge)
        const applied = mutation.mutation
        if (row.outcome === 'whole' && badge !== row.badge) {
          violations.push({ invariant: 'badge-shows-duration', detail: `badge reads "${badge}", expected "${row.badge}"` })
        }
        if (row.outcome === 'reject-or-partial' && seconds > sourceSeconds) {
          violations.push({ invariant: 'truncated-duration-bounded', detail: `badge reads "${badge}" for a prefix of a ${sourceSeconds} s file` })
        }
        const halfOrMore = applied.kind === 'truncate' && applied.fraction >= 0.5
        if (halfOrMore && seconds === 0 && sourceSeconds >= 1) {
          violations.push({ invariant: 'truncated-duration-positive', detail: `badge reads "${badge}" for the first half of a ${sourceSeconds} s file` })
        }
        const pageErrors = errors.filter((error) => error.startsWith('pageerror:'))
        if (pageErrors.length > 0) violations.push({ invariant: 'no-page-errors', detail: pageErrors.join(' | ') })
      }
      settle(row.id, violations)
    })
  }
})
