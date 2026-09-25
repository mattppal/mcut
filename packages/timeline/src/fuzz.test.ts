import { expect, test } from 'bun:test'
import { listToolDefinitions } from './commands'
import { knownFailures } from './fuzz/known-failures'
import { minimizeSteps } from './fuzz/minimize'
import { commandOverrides, generatePlan } from './fuzz/plan'
import { formatFailure, runCommandPlan } from './fuzz/run-commands'

const BASE_SEED = 1
const MIN_ACCEPTED_RATIO = 0.3

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got "${raw}"`)
  return value
}

const sequences = envInt('MCUT_FUZZ_SEQUENCES', 1000)
const length = envInt('MCUT_FUZZ_LENGTH', 60)
const onlySeed = process.env.MCUT_FUZZ_SEED
const seeds = onlySeed === undefined || onlySeed === '' ? Array.from({ length: sequences }, (_, i) => BASE_SEED + i) : [envInt('MCUT_FUZZ_SEED', BASE_SEED)]
const known = onlySeed ? [] : knownFailures

test(`${seeds.length} random command sequences of ${length} steps keep every engine invariant`, async () => {
  const tools = listToolDefinitions()
  let applied = 0
  let rejected = 0
  const knownHits = new Map<string, number>()
  for (const seed of seeds) {
    const plan = generatePlan({ seed, tools, length, overrides: commandOverrides })
    const result = runCommandPlan(plan, { known })
    applied += result.applied
    rejected += result.rejected
    for (const [issue, count] of result.knownFailures) knownHits.set(issue, (knownHits.get(issue) ?? 0) + count)
    if (result.failure) {
      const stillFails = (subset: typeof plan.steps) => runCommandPlan({ seed, steps: subset }, { known }).failure !== undefined
      const steps = await minimizeSteps(plan.steps, stillFails)
      const minimized = runCommandPlan({ seed, steps }, { known })
      console.log(formatFailure({ seed, steps }, minimized))
      const failure = minimized.failure ?? result.failure
      throw new Error(
        `seed ${seed} violated ${failure.violations.map((v) => v.invariant).join(', ')} ` +
          `at step ${failure.stepIndex} (${failure.command.type}); the minimized plan is printed above`,
      )
    }
  }
  const ratio = applied / (applied + rejected)
  console.log(`fuzz applied ${applied}, rejected ${rejected}, accepted ratio ${ratio.toFixed(3)}`)
  for (const entry of known) console.log(`known failure ${entry.issue} hit ${knownHits.get(entry.issue) ?? 0} times`)
  expect(ratio).toBeGreaterThanOrEqual(MIN_ACCEPTED_RATIO)
  const fixed = known.filter((entry) => !knownHits.has(entry.issue)).map((entry) => entry.issue)
  expect(fixed, 'known failures that no longer reproduce must leave known-failures.ts').toEqual([])
}, 120_000)

test('seed 1 always yields the same second step', () => {
  const plan = generatePlan({ seed: 1, tools: listToolDefinitions(), length: 2, overrides: commandOverrides })
  expect(plan.steps[1]).toEqual({
    tool: 'addAsset',
    args: {
      asset: { id: 'a-fz531a1b', kind: 'video', src: 'camera', mimeType: 'Hello world', nativePreview: true },
    },
  })
})
