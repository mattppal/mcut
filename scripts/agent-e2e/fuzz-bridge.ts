import { parseArgs } from 'node:util'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpFuzzServer } from '../../packages/mcp-server/src/fuzz/stdio-harness'
import { addTallies, emptyTallies, formatMcpFailure, runMcpPlan, type FamilyTallies } from '../../packages/mcp-server/src/fuzz/run-mcp'
import { knownFailures } from '../../packages/timeline/src/fuzz/known-failures'
import { minimizeSteps } from '../../packages/timeline/src/fuzz/minimize'
import { commandOverrides, generatePlan, type FuzzTool, type StepTemplate } from '../../packages/timeline/src/fuzz/plan'
import { openBridgeSession } from './bridge-session'
import { createRunDir } from './report'

const USAGE = [
  'usage: bun scripts/agent-e2e/fuzz-bridge.ts [--seeds N] [--length N] [--seed S]',
  '',
  'Runs random tool sequences against the Electron desktop app over the live bridge and checks',
  'the same project invariants as the stdio fuzzer in packages/mcp-server.',
  '',
  'env  MCUT_FUZZ_SEQUENCES  seed count, default 20 (--seeds wins)',
  '     MCUT_FUZZ_LENGTH     steps per sequence, default 20 (--length wins)',
  '     MCUT_FUZZ_SEED       run one seed and ignore known failures (--seed wins)',
  '',
  'display  the app window shows on the current display, wrap in xvfb-run --auto-servernum on a headless machine',
].join('\n')

const BASE_SEED = 1
const DEFAULT_SEQUENCES = 20
const DEFAULT_LENGTH = 20
const EXIT_FAILED = 1

const SLOW_TOOLS = new Set(['ensure_transcript', 'ensure_voice_stems'])

interface Options {
  seeds: number[]
  length: number
  known: boolean
}

const log = (line: string): void => console.error(`[fuzz-bridge] ${line}`)

function integer(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`)
  return value
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      seeds: { type: 'string' },
      length: { type: 'string' },
      seed: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const only = values.seed ?? process.env.MCUT_FUZZ_SEED
  const sequences = integer(values.seeds ?? process.env.MCUT_FUZZ_SEQUENCES, DEFAULT_SEQUENCES, 'seeds')
  return {
    seeds: only === undefined || only === '' ? Array.from({ length: sequences }, (_, i) => BASE_SEED + i) : [integer(only, BASE_SEED, 'seed')],
    length: integer(values.length ?? process.env.MCUT_FUZZ_LENGTH, DEFAULT_LENGTH, 'length'),
    known: only === undefined || only === '',
  }
}

async function resetTab(server: McpFuzzServer): Promise<void> {
  const snapshot = await server.project()
  if (snapshot.kind !== 'parsed') throw new Error(`the tab project does not parse before a reset (${snapshot.message.slice(0, 300)})`)
  for (const track of snapshot.project.tracks) await server.call('removeTrack', { trackId: track.id })
  for (const assetId of Object.keys(snapshot.project.assets)) await server.call('removeAsset', { assetId })
  await server.call('updateProject', { name: 'fuzz-bridge', width: 1920, height: 1080, fps: 30 })
}

function printTallies(totals: FamilyTallies): void {
  for (const [family, tally] of Object.entries(totals)) {
    log(`${family} tools saw ok ${tally.ok}, typed-error ${tally['typed-error']}, untyped-error ${tally['untyped-error']}`)
  }
}

async function fuzz(server: McpFuzzServer, options: Options): Promise<number> {
  const tools: FuzzTool[] = (await server.listTools()).filter((tool) => !SLOW_TOOLS.has(tool.name))
  const known = options.known ? knownFailures : []
  log(
    `${options.seeds.length} sequences of ${options.length} steps over ${tools.length} tools (${[...SLOW_TOOLS].join(', ')} left out, on-device processing can take minutes)`,
  )
  const totals = emptyTallies()
  const startedAt = Date.now()
  for (const seed of options.seeds) {
    await resetTab(server)
    const plan = generatePlan({ seed, tools, length: options.length, overrides: commandOverrides })
    const result = await runMcpPlan(plan, server, { known })
    addTallies(totals, result.byFamily)
    if (result.failure === undefined) continue
    const stillFails = async (subset: StepTemplate[]): Promise<boolean> => {
      await resetTab(server)
      return (await runMcpPlan({ seed, steps: subset }, server, { known })).failure !== undefined
    }
    const steps = await minimizeSteps(plan.steps, stillFails)
    await resetTab(server)
    const minimized = await runMcpPlan({ seed, steps }, server, { known })
    console.log(formatMcpFailure({ seed, steps }, minimized))
    const failure = minimized.failure ?? result.failure
    log(
      `seed ${seed} violated ${failure.violations.map((violation) => violation.invariant).join(', ')} at step ${failure.stepIndex} (${failure.tool}). ` +
        `Reproduce with MCUT_FUZZ_SEED=${seed} bun run fuzz:mcp:bridge`,
    )
    printTallies(totals)
    return EXIT_FAILED
  }
  printTallies(totals)
  console.log(
    `${options.seeds.length} of ${options.seeds.length} bridge fuzz sequences of ${options.length} steps kept every project invariant in ${Date.now() - startedAt} ms`,
  )
  return 0
}

async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv)
  const runDir = createRunDir('bridge-fuzz')
  const session = await openBridgeSession({ logDir: runDir })
  try {
    const server = await McpFuzzServer.connect(new StreamableHTTPClientTransport(new URL(session.mcpUrl)))
    try {
      return await Promise.race([fuzz(server, options), session.lost])
    } finally {
      await server.close()
    }
  } finally {
    await session.close()
    log(`app log in ${runDir}`)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      log(error instanceof Error ? error.message : String(error))
      process.exit(EXIT_FAILED)
    })
}
