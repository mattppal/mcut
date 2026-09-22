import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { describe, summarize, type Fixtures, type Outcome, type Report, type Row, type SurfaceContext } from './context.ts'
import { DRIVERS } from './drivers/index.ts'
import { featuresForTier, SURFACES, TIERS, type Feature, type Surface, type Tier } from './features.ts'
import { openEmbed } from './surfaces/embed.ts'
import { openElectron } from './surfaces/electron.ts'
import type { OpenSurface } from './surfaces/handle.ts'
import { probeWhisperNetwork } from './whisper.ts'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const FIXTURE_DIR = path.join(repoRoot, 'apps/studio/e2e/fixtures')
const FEATURE_TIMEOUT_MS = 180_000
const WHISPER_TIMEOUT_MS = 900_000
const USAGE = 'usage: node apps/studio/smoke/run.ts --surface <embed|electron-dev|installed> [--tier fast|full] [--out <dir>] [--electron <binary>] [--only <feature,...>]'

function isSurface(value: string): value is Surface {
  return SURFACES.some((surface) => surface === value)
}

function isTier(value: string): value is Tier {
  return TIERS.some((tier) => tier === value)
}

function openerFor(surface: Surface): OpenSurface {
  switch (surface) {
    case 'embed':
      return openEmbed
    case 'electron-dev':
    case 'installed':
      return openElectron(surface)
    default: {
      const exhaustive: never = surface
      return exhaustive
    }
  }
}

function timeoutFor(feature: Feature): number {
  return feature.id === 'captions-on-device' ? WHISPER_TIMEOUT_MS : FEATURE_TIMEOUT_MS
}

async function settle(ctx: SurfaceContext): Promise<void> {
  const open = ctx.view.getByRole('dialog').or(ctx.view.getByRole('menu'))
  for (let attempt = 0; attempt < 3 && (await open.count()) > 0; attempt += 1) {
    await ctx.page.keyboard.press('Escape')
    await ctx.view.waitForTimeout(300)
  }
}

async function runFeature(feature: Feature, ctx: SurfaceContext, index: number): Promise<Outcome> {
  const availability = feature.surfaces[ctx.surface]
  if (availability.kind === 'unsupported') return { status: 'unsupported', reason: availability.reason }
  const driver = DRIVERS[feature.id]
  if (driver === null) return { status: 'missing-driver' }
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  await settle(ctx)
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutFor(feature)} ms`)), timeoutFor(feature)).unref())
  const file = path.join(ctx.outDir, `${String(index).padStart(2, '0')}-${feature.id}.png`)
  const screenshot = () =>
    ctx.page
      .screenshot({ path: file })
      .then(() => file)
      .catch(() => null)
  try {
    const result = await Promise.race([driver(ctx), timeout])
    if (result.kind === 'blocked') return { status: 'blocked', reason: result.reason, screenshot: await screenshot(), ms: ms() }
    return { status: 'pass', observed: result.observed, screenshot: await screenshot(), ms: ms() }
  } catch (error) {
    return { status: 'fail', error: error instanceof Error ? error.message : String(error), screenshot: await screenshot(), ms: ms() }
  }
}

function markdown(report: Report): string {
  const counts = summarize(report.rows)
  const lines = [
    `# Studio smoke, ${report.surface}, ${report.tier} tier`,
    '',
    `Target ${report.target}. Whisper network ${report.whisper.mode}. ${counts.pass} pass, ${counts.fail} fail, ${counts.blocked} blocked, ${counts.unsupported} unsupported, ${counts['missing-driver']} without a driver.`,
    '',
    '| Feature | Status | Observed |',
    '| --- | --- | --- |',
    ...report.rows.map((row) => `| ${row.feature} | ${row.outcome.status} | ${describe(row.outcome).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
  ]
  if (report.pageErrors.length > 0) lines.push('', '## Page errors', '', ...report.pageErrors.map((message) => `- ${message}`))
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      surface: { type: 'string' },
      tier: { type: 'string', default: 'full' },
      out: { type: 'string' },
      electron: { type: 'string' },
      only: { type: 'string' },
    },
  })
  const surface = values.surface
  const tier = values.tier
  if (surface === undefined || !isSurface(surface) || tier === undefined || !isTier(tier)) {
    console.error(USAGE)
    process.exit(2)
  }
  const outDir = path.resolve(values.out ?? path.join(repoRoot, 'reports/smoke', surface))
  await mkdir(outDir, { recursive: true })
  const only = values.only === undefined ? null : new Set(values.only.split(','))
  const fixtures: Fixtures = {
    clip: path.join(FIXTURE_DIR, 'fixture-vp9.mkv'),
    speech: path.join(FIXTURE_DIR, 'fixture-speech.mkv'),
    image: path.join(FIXTURE_DIR, 'fixture.png'),
  }
  const log = (line: string) => console.log(`     ${line}`)
  const { network, mirror } = await probeWhisperNetwork(process.env.MCUT_WHISPER_MIRROR ?? null)
  console.log(`whisper network: ${network.mode}${network.mode === 'mirror' ? ` at ${network.url}` : network.mode === 'offline' ? `, ${network.reason}` : ''}`)

  const handle = await openerFor(surface)({
    fixtures,
    outDir,
    whisper: network,
    assemblyAiKey: process.env.ASSEMBLYAI_API_KEY ?? null,
    electronPath: values.electron ?? process.env.MCUT_ELECTRON_PATH ?? null,
    log,
  })
  console.log(`target: ${handle.target}`)
  const report: Report = { surface, tier, target: handle.target, startedAt: new Date().toISOString(), whisper: network, rows: [], pageErrors: handle.pageErrors }
  try {
    const features = featuresForTier(tier).filter((feature) => only === null || only.has(feature.id))
    for (const [index, feature] of features.entries()) {
      const outcome = await runFeature(feature, handle.ctx, index + 1)
      const row: Row = { feature: feature.id, surface, outcome }
      report.rows.push(row)
      const ms = 'ms' in outcome ? ` (${outcome.ms} ms)` : ''
      console.log(`${outcome.status.padEnd(14)} ${feature.id}: ${describe(outcome)}${ms}`)
    }
  } finally {
    await handle.close().catch((error: unknown) => console.error(error instanceof Error ? error.message : String(error)))
    await mirror?.close()
  }
  await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(path.join(outDir, 'report.md'), markdown(report))
  const counts = summarize(report.rows)
  console.log(`\nreport: ${path.join(outDir, 'report.md')}`)
  console.log(`RESULT ${counts.fail === 0 ? 'PASS' : 'FAIL'} pass=${counts.pass} fail=${counts.fail} blocked=${counts.blocked} unsupported=${counts.unsupported} missing=${counts['missing-driver']}`)
  process.exit(counts.fail === 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
