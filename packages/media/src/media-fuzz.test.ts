import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { fixturesDir, fuzzEntries, loadFixtureManifest } from './fuzz/fixtures'
import { knownFailures, matchKnownFailure, type KnownFailure } from './fuzz/known-failures'
import { DEFAULT_PROBE_TIMEOUT_MS, ProbeRunner } from './fuzz/probe-runner'
import { describeOutcome, formatFailure, runProbeFuzz } from './fuzz/run-probe'
import { decodeMonoPcm, GAP_TOLERANCE_MS, scoreSilence } from './fuzz/silence'

const silenceInvariants = ['activity-finds-gaps', 'no-phantom-silence', 'planner-cuts-gaps']

const dir = fixturesDir()
const manifest = loadFixtureManifest(dir)
const onlyFixture = process.env.MCUT_FUZZ_FIXTURE
const verbose = process.env.MCUT_FUZZ_VERBOSE === '1'
const selected = (id: string) => onlyFixture === undefined || onlyFixture === '' || id === onlyFixture
const known = onlyFixture ? [] : knownFailures

if (manifest === null) {
  const message = `no fixture manifest in ${dir}, run bun run fixtures to generate one`
  if (process.env.MCUT_FUZZ_REQUIRE_FIXTURES === '1') throw new Error(message)
  console.log(`media fuzz skipped, ${message}`)
}

const entries = manifest === null ? [] : fuzzEntries(manifest, dir).filter((entry) => selected(entry.id))
const gapFixtures = (manifest?.fixtures ?? []).filter(
  (fixture) => fixture.skipped === null && fixture.recipe.silenceGaps.length > 0 && selected(fixture.id),
)

const spans = (windows: ReadonlyArray<{ startMs: number; endMs: number }>) =>
  windows.map((window) => `${window.startMs}-${window.endMs}`).join(' ') || 'none'

function assertStillFailing(relevant: readonly KnownFailure[], hits: ReadonlyMap<string, number>): void {
  for (const entry of relevant) console.log(`known failure ${entry.issue} hit ${hits.get(entry.issue) ?? 0} times`)
  const fixed = relevant.filter((entry) => !hits.has(entry.issue)).map((entry) => entry.issue)
  expect(fixed, 'known failures that no longer reproduce must leave known-failures.ts').toEqual([])
}

test.skipIf(entries.length === 0)(
  `${entries.length} fixtures and mutations probe to ground truth or a typed MediaProbeError`,
  async () => {
    const runner = new ProbeRunner(Number(process.env.MCUT_FUZZ_PROBE_TIMEOUT_MS ?? DEFAULT_PROBE_TIMEOUT_MS))
    const started = performance.now()
    try {
      const result = await runProbeFuzz(entries, runner, {
        known,
        onEntry: (entry, outcome, violations) => {
          if (!verbose && violations.length === 0) return
          const tags = violations.map((violation) => `[${violation.invariant}]`).join(' ')
          console.log(`${entry.id.padEnd(40)} ${describeOutcome(outcome)} ${outcome.elapsedMs}ms ${tags}`)
        },
      })
      if (result.failure) throw new Error(formatFailure(result.failure))
      const seconds = ((performance.now() - started) / 1000).toFixed(1)
      console.log(`media fuzz probed ${result.probed}, rejected ${result.rejected} of ${entries.length} in ${seconds}s`)
      const relevant = known.filter((entry) => !entry.invariants.some((name) => silenceInvariants.includes(name)))
      assertStillFailing(relevant, result.knownFailures)
    } finally {
      runner.close()
    }
  },
  180_000,
)

test.skipIf(gapFixtures.length === 0)(
  `recipe silence gaps in ${gapFixtures.length} audio fixtures are found within ${GAP_TOLERANCE_MS} ms`,
  async () => {
    const hits = new Map<string, number>()
    for (const fixture of gapFixtures) {
      const sampleRate = fixture.recipe.sampleRate
      const samples = await decodeMonoPcm(join(dir, fixture.file), sampleRate)
      const score = scoreSilence(fixture, samples, sampleRate)
      console.log(
        `${fixture.id.padEnd(20)} gaps ${spans(fixture.recipe.silenceGaps)}  ` +
          `silence ${spans(score.activity.silenceWindows)}  cuts ${spans(score.cuts)}`,
      )
      if (score.violations.length === 0) continue
      const match = matchKnownFailure(fixture.id, score.violations, known)
      if (!match) {
        const lines = score.violations.map((violation) => `  [${violation.invariant}] ${violation.detail}`)
        throw new Error([`silence scoring failed on ${fixture.id}`, ...lines].join('\n'))
      }
      hits.set(match.issue, (hits.get(match.issue) ?? 0) + 1)
    }
    const relevant = known.filter((entry) => entry.invariants.every((name) => silenceInvariants.includes(name)))
    assertStillFailing(relevant, hits)
  },
  60_000,
)
