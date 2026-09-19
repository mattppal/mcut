import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseManifest, type ManifestFixture } from '../fixtures/manifest'

export const repoRoot = resolve(import.meta.dirname, '..', '..')

const MANIFEST_DIR = 'fixtures/media'

const FALLBACK_PATH = 'apps/studio/e2e/fixtures/fixture-vp9.mkv'

export type FixtureSource = 'manifest' | 'fallback'

export interface Fixture {
  id: string
  path: string
  absolutePath: string
  name: string
  kind: 'video' | 'audio' | 'image'
  durationMs: number
  width: number
  height: number
  fps: number | 'vfr'
  source: FixtureSource
}

const fallbackFixture = (id: string): Fixture => ({
  id,
  path: FALLBACK_PATH,
  absolutePath: join(repoRoot, FALLBACK_PATH),
  name: basename(FALLBACK_PATH),
  kind: 'video',
  durationMs: 2008,
  width: 640,
  height: 360,
  fps: 30,
  source: 'fallback',
})

function fromManifest(entry: ManifestFixture): Fixture {
  const path = `${MANIFEST_DIR}/${entry.file}`
  return {
    id: entry.id,
    path,
    absolutePath: join(repoRoot, path),
    name: entry.file,
    kind: entry.recipe.videoCodec === null ? 'audio' : 'video',
    durationMs: entry.recipe.durationMs,
    width: entry.recipe.width,
    height: entry.recipe.height,
    fps: entry.recipe.fps,
    source: 'manifest',
  }
}

function readManifest(): Map<string, Fixture> {
  const file = join(repoRoot, MANIFEST_DIR, 'manifest.json')
  if (!existsSync(file)) return new Map()
  const parsed = parseManifest(JSON.parse(readFileSync(file, 'utf8')))
  return new Map(
    parsed.fixtures
      .filter((entry) => entry.skipped === null)
      .map((entry): [string, Fixture] => [entry.id, fromManifest(entry)]),
  )
}

const manifest = readManifest()

export function resolveFixture(id: string): Fixture {
  const found = manifest.get(id)
  if (found && existsSync(found.absolutePath)) return found
  return fallbackFixture(id)
}

export function describeFixture(fixture: Fixture): string {
  return (
    `${fixture.id}: path ${fixture.path}, kind ${fixture.kind}, ` +
    `${fixture.width}x${fixture.height}, ${fixture.fps} fps, ${fixture.durationMs} ms ` +
    `(source ${fixture.source})`
  )
}
