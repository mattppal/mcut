import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandOverrides, generatePlan, type FuzzTool, type StepTemplate } from '../../timeline/src/fuzz/plan'
import { minimizeSteps } from '../../timeline/src/fuzz/minimize'
import { knownFailures } from '../../timeline/src/fuzz/known-failures'
import { addTallies, classifyReply, emptyTallies, formatMcpFailure, runMcpPlan, toolFamily } from './fuzz/run-mcp'
import { McpFuzzServer } from './fuzz/stdio-harness'

const BASE_SEED = 1
const MIN_ACCEPTED_RATIO = 0.3

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got "${raw}"`)
  return value
}

const sequences = envInt('MCUT_FUZZ_SEQUENCES', 60)
const length = envInt('MCUT_FUZZ_LENGTH', 40)
const onlySeed = process.env.MCUT_FUZZ_SEED
const seeds = onlySeed === undefined || onlySeed === '' ? Array.from({ length: sequences }, (_, i) => BASE_SEED + i) : [envInt('MCUT_FUZZ_SEED', BASE_SEED)]
const known = onlySeed ? [] : knownFailures

let projectDir = ''
let spawned = 0
let tools: FuzzTool[] = []

async function withServer<T>(run: (server: McpFuzzServer) => Promise<T>): Promise<T> {
  const server = await McpFuzzServer.spawn(join(projectDir, `project-${spawned++}.json`))
  try {
    return await run(server)
  } finally {
    await server.close()
  }
}

function addCounts(into: Map<string, number>, from: Map<string, number>): void {
  for (const [key, count] of from) into.set(key, (into.get(key) ?? 0) + count)
}

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'mcut-mcp-fuzz-'))
  tools = await withServer((server) => server.listTools())
})

afterAll(() => rm(projectDir, { recursive: true, force: true }))

test(`${seeds.length} random tool sequences of ${length} steps over stdio keep every project invariant`, async () => {
  const totals = emptyTallies()
  const untypedStatic = new Map<string, number>()
  const knownHits = new Map<string, number>()
  for (const seed of seeds) {
    const plan = generatePlan({ seed, tools, length, overrides: commandOverrides })
    const result = await withServer((server) => runMcpPlan(plan, server, { known }))
    addTallies(totals, result.byFamily)
    addCounts(untypedStatic, result.untypedByStaticTool)
    addCounts(knownHits, result.knownFailures)
    if (result.failure) {
      const stillFails = (subset: StepTemplate[]) =>
        withServer(async (server) => (await runMcpPlan({ seed, steps: subset }, server, { known })).failure !== undefined)
      const steps = await minimizeSteps(plan.steps, stillFails)
      const minimized = await withServer((server) => runMcpPlan({ seed, steps }, server, { known }))
      console.log(formatMcpFailure({ seed, steps }, minimized))
      const failure = minimized.failure ?? result.failure
      throw new Error(
        `seed ${seed} violated ${failure.violations.map((violation) => violation.invariant).join(', ')} ` +
          `at step ${failure.stepIndex} (${failure.tool}); the minimized plan is printed above`,
      )
    }
  }
  for (const [family, tally] of Object.entries(totals)) {
    console.log(`mcp fuzz ${family} tools saw ok ${tally.ok}, typed-error ${tally['typed-error']}, untyped-error ${tally['untyped-error']}`)
  }
  for (const [tool, count] of untypedStatic) console.log(`untyped error from static tool ${tool} ${count} times`)
  for (const entry of known) console.log(`known failure ${entry.issue} hit ${knownHits.get(entry.issue) ?? 0} times`)
  const { command } = totals
  const ratio = command.ok / (command.ok + command['typed-error'] + command['untyped-error'])
  console.log(`command tools accepted ratio ${ratio.toFixed(3)}`)
  expect(ratio).toBeGreaterThanOrEqual(MIN_ACCEPTED_RATIO)
}, 240_000)

test('one stdio server answers an edit, a typed rejection, and a static untyped error', async () => {
  await withServer(async (server) => {
    const added = await server.call('addTrack', { name: 'B-roll' })
    expect(classifyReply(added)).toBe('ok')
    const snapshot = await server.project()
    const trackNames = snapshot.kind === 'parsed' ? snapshot.project.tracks.map((track) => track.name) : snapshot.message
    expect(trackNames).toEqual(['Track 1', 'B-roll'])
    const ghost = await server.call('removeElement', { elementId: 'e-ghost' })
    expect(classifyReply(ghost)).toBe('typed-error')
    expect(ghost.text).toStartWith('CommandError (unknown-element): ')
    const live = await server.call('ensure_transcript', {})
    expect(classifyReply(live)).toBe('untyped-error')
    expect(live.text).toBe('ensure_transcript requires a live browser bridge connected to an editor tab.')
  })
  expect(['addTrack', 'operator_edit_undo', 'undo'].map(toolFamily)).toEqual(['command', 'operator', 'static'])
})

test('operator_media_insertAssetAtPlayhead rejects a missing asset as a typed OperatorError', async () => {
  await withServer(async (server) => {
    const reply = await server.call('operator_media_insertAssetAtPlayhead', { assetId: 'a-missing' })
    expect(classifyReply(reply)).toBe('typed-error')
    expect(reply.text).toBe('OperatorError (unknown-asset): no asset "a-missing"')
  })
})

test('seed 1 always yields the same second step over the stdio tool list', () => {
  const plan = generatePlan({ seed: 1, tools, length: 2, overrides: commandOverrides })
  expect(plan.steps[1]).toEqual({
    tool: 'addElement',
    args: {
      trackId: { $slot: 'track', index: 3 },
      element: {
        id: 'e-fzee5432',
        type: 'audio',
        startMs: 3197,
        durationMs: 1655,
        keyframes: {},
        assetId: { $slot: 'asset', index: 1 },
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 2630, value: 2139 },
          { timeMs: 6062, value: 3863 },
          { timeMs: 7289, value: 6543 },
        ],
        reversed: false,
        muted: true,
      },
    },
  })
})
