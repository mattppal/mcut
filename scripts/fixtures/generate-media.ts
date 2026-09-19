import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  parseManifest,
  type FixtureManifest,
  type ManifestFixture,
  type ManifestMutation,
  type Mutation,
} from './manifest'
import { applyByteMutation, variantsFor } from './mutate'
import { containerExtension, recipes, type FixtureRecipe } from './recipes'
import { detectTooling, exec, planRender, probeTruth, stillImageArgs, type Tooling } from './render'

export const defaultFixturesDir = resolve(import.meta.dirname, '..', '..', 'fixtures', 'media')
export const MANIFEST_FILE = 'manifest.json'

const RENDER_VERSION = 1
const CONCURRENCY = 4

export interface GenerateOptions {
  outDir: string
  recipes: readonly FixtureRecipe[]
  mutate: boolean
  log: (line: string) => void
}

type Status = 'rendered' | 'cached' | 'skipped'

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

const stableJson = (value: unknown): string => JSON.stringify(value)

const recipeHash = (recipe: FixtureRecipe, tooling: Tooling): string =>
  sha256(new TextEncoder().encode(stableJson({ recipe, ffmpeg: tooling.ffmpeg, render: RENDER_VERSION })))

const mutationHash = (sourceSha256: string, mutation: Mutation): string =>
  sha256(new TextEncoder().encode(stableJson({ sourceSha256, mutation, render: RENDER_VERSION })))

const fileName = (id: string, recipe: FixtureRecipe): string => `${id}.${containerExtension[recipe.container]}`

const kilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1).padStart(8)} KB`

function codecLabel(recipe: FixtureRecipe): string {
  return [recipe.videoCodec, recipe.audioCodec].filter((codec) => codec !== null).join('+') || 'none'
}

function fixtureLine(entry: ManifestFixture, status: Status): string {
  const recipe = entry.recipe
  const shape = recipe.videoCodec === null ? `${recipe.sampleRate}Hz x${recipe.channels}` : `${recipe.width}x${recipe.height}`
  const columns = [
    entry.id.padEnd(28),
    recipe.container.padEnd(5),
    codecLabel(recipe).padEnd(17),
    shape.padEnd(12),
    `${String(recipe.durationMs).padStart(6)}ms`,
    kilobytes(entry.bytes),
    `${(entry.generationMs / 1000).toFixed(2).padStart(6)}s`,
    status,
  ]
  return entry.skipped === null ? columns.join('  ') : `${columns.join('  ')}  (${entry.skipped})`
}

async function readExisting(outDir: string): Promise<FixtureManifest | null> {
  const path = join(outDir, MANIFEST_FILE)
  if (!existsSync(path)) return null
  try {
    return parseManifest(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    throw new Error(`${path} is not a fixture manifest; delete it to regenerate. ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function fileMatches(path: string, expectedSha256: string | null): Promise<boolean> {
  if (expectedSha256 === null || !existsSync(path)) return false
  return sha256(new Uint8Array(await readFile(path))) === expectedSha256
}

async function runPool<T, R>(items: readonly T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      const item = items[index]
      if (item !== undefined) results[index] = await worker(item)
    }
  })
  await Promise.all(lanes)
  return results
}

async function renderFixture(recipe: FixtureRecipe, outDir: string, tooling: Tooling): Promise<ManifestFixture> {
  const file = fileName(recipe.id, recipe)
  const output = join(outDir, file)
  const base = { id: recipe.id, file, recipe, recipeHash: recipeHash(recipe, tooling) }
  const started = performance.now()
  let stillImage: string | null = null
  if (recipe.stillImage) {
    stillImage = join(outDir, `${recipe.id}.still.png`)
    const still = await exec(stillImageArgs(recipe, stillImage))
    if (still.code !== 0) throw new Error(`${recipe.id}: still image render failed\n${still.stderr}`)
  }
  const plan = planRender(recipe, tooling, stillImage, output)
  if (plan.kind === 'skip') {
    await rm(output, { force: true })
    return { ...base, sha256: null, bytes: 0, generationMs: 0, measured: null, skipped: plan.reason }
  }
  const result = await exec(plan.args)
  if (result.code !== 0) throw new Error(`${recipe.id}: ffmpeg failed\n${plan.args.join(' ')}\n${result.stderr}`)
  const bytes = new Uint8Array(await readFile(output))
  const measured = await probeTruth(output)
  return {
    ...base,
    sha256: sha256(bytes),
    bytes: bytes.length,
    generationMs: Math.round(performance.now() - started),
    measured,
    skipped: null,
  }
}

async function fixtureFor(
  recipe: FixtureRecipe,
  outDir: string,
  tooling: Tooling,
  existing: FixtureManifest | null,
): Promise<{ entry: ManifestFixture; status: Status }> {
  const previous = existing?.fixtures.find((fixture) => fixture.id === recipe.id)
  if (previous !== undefined && previous.recipeHash === recipeHash(recipe, tooling) && previous.skipped === null) {
    if (await fileMatches(join(outDir, previous.file), previous.sha256)) {
      return { entry: previous, status: 'cached' }
    }
  }
  const entry = await renderFixture(recipe, outDir, tooling)
  return { entry, status: entry.skipped === null ? 'rendered' : 'skipped' }
}

async function moovAtEnd(source: string, output: string): Promise<void> {
  const args = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-c', 'copy']
  args.push('-map_metadata', '-1', '-flags', '+bitexact', '-fflags', '+bitexact', output)
  const result = await exec(args)
  if (result.code !== 0) throw new Error(`moov-at-end remux failed for ${source}\n${result.stderr}`)
}

async function mutationFor(
  fixture: ManifestFixture,
  suffix: string,
  mutation: Mutation,
  outDir: string,
  existing: FixtureManifest | null,
): Promise<{ entry: ManifestMutation; status: Status }> {
  const id = `${fixture.id}.${suffix}`
  const file = fileName(id, fixture.recipe)
  const output = join(outDir, file)
  const hash = mutationHash(fixture.sha256 ?? '', mutation)
  const previous = existing?.mutations.find((entry) => entry.id === id)
  if (previous !== undefined && previous.mutationHash === hash && (await fileMatches(output, previous.sha256))) {
    return { entry: previous, status: 'cached' }
  }
  const source = new Uint8Array(await readFile(join(outDir, fixture.file)))
  const mutated = applyByteMutation(source, mutation)
  if (mutated === null) await moovAtEnd(join(outDir, fixture.file), output)
  else await writeFile(output, mutated)
  const bytes = new Uint8Array(await readFile(output))
  return {
    entry: {
      id,
      sourceId: fixture.id,
      file,
      sha256: sha256(bytes),
      bytes: bytes.length,
      mutationHash: hash,
      mutation,
      expected: 'reject-or-partial',
    },
    status: 'rendered',
  }
}

function mutationLine(entry: ManifestMutation, status: Status): string {
  const detail = Object.entries(entry.mutation)
    .filter(([key]) => key !== 'kind')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
  return [entry.id.padEnd(37), entry.mutation.kind.padEnd(12), detail.padEnd(36), kilobytes(entry.bytes), status].join('  ')
}

async function pruneUnreferenced(outDir: string, manifest: FixtureManifest): Promise<void> {
  const keep = new Set([MANIFEST_FILE, ...manifest.fixtures.map((fixture) => fixture.file), ...manifest.mutations.map((entry) => entry.file)])
  for (const fixture of manifest.fixtures) keep.add(`${fixture.id}.still.png`)
  for (const name of await readdir(outDir)) {
    if (!keep.has(name)) await rm(join(outDir, name), { force: true })
  }
}

export async function generateFixtures(options: GenerateOptions): Promise<FixtureManifest> {
  const tooling = await detectTooling()
  if (tooling === null) throw new Error('ffmpeg is not on PATH; install ffmpeg 6 or newer to generate fixtures')
  await mkdir(options.outDir, { recursive: true })
  const existing = await readExisting(options.outDir)

  const fixtures = await runPool(options.recipes, async (recipe) => {
    const result = await fixtureFor(recipe, options.outDir, tooling, existing)
    options.log(fixtureLine(result.entry, result.status))
    return result.entry
  })

  const mutations: ManifestMutation[] = []
  if (options.mutate) {
    const jobs = fixtures
      .filter((fixture) => fixture.skipped === null)
      .flatMap((fixture) =>
        variantsFor(fixture.id, fixture.recipe.container, fixture.bytes).map((variant) => ({ fixture, variant })),
      )
    const entries = await runPool(jobs, async ({ fixture, variant }) => {
      const result = await mutationFor(fixture, variant.suffix, variant.mutation, options.outDir, existing)
      options.log(mutationLine(result.entry, result.status))
      return result.entry
    })
    mutations.push(...entries)
  }

  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
  const manifest: FixtureManifest = {
    version: 1,
    ffmpeg: tooling.ffmpeg,
    fixtures: [...fixtures].sort(byId),
    mutations: mutations.sort(byId),
  }
  await writeFile(join(options.outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
  await pruneUnreferenced(options.outDir, manifest)
  return manifest
}

function optionValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

async function main(argv: readonly string[]): Promise<number> {
  const only = optionValue(argv, '--only')
  const selected = only === undefined ? recipes : recipes.filter((recipe) => only.split(',').includes(recipe.id))
  if (selected.length === 0) {
    console.error(`--only matched no recipe ids; known ids: ${recipes.map((recipe) => recipe.id).join(', ')}`)
    return 1
  }
  const started = performance.now()
  const manifest = await generateFixtures({
    outDir: resolve(optionValue(argv, '--out') ?? defaultFixturesDir),
    recipes: selected,
    mutate: argv.includes('--mutate'),
    log: (line) => console.log(line),
  })
  const skipped = manifest.fixtures.filter((fixture) => fixture.skipped !== null).length
  const bytes = [...manifest.fixtures, ...manifest.mutations].reduce((sum, entry) => sum + entry.bytes, 0)
  console.log(
    `${manifest.fixtures.length} fixtures (${skipped} skipped), ${manifest.mutations.length} mutations, ` +
      `${(bytes / 1_048_576).toFixed(1)} MB in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  )
  return 0
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
