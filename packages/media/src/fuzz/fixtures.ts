import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  parseManifest,
  type FixtureManifest,
  type ManifestFixture,
  type ManifestMutation,
} from '../../../../scripts/fixtures/manifest'

export type { FixtureManifest, ManifestFixture, ManifestMutation }

export type FuzzEntry =
  | { kind: 'fixture'; id: string; path: string; fixture: ManifestFixture }
  | { kind: 'mutation'; id: string; path: string; mutation: ManifestMutation; source: ManifestFixture }

export const defaultFixturesDir = resolve(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'media')

export function fixturesDir(): string {
  return process.env.MCUT_FIXTURES_DIR ?? defaultFixturesDir
}

export function loadFixtureManifest(dir = fixturesDir()): FixtureManifest | null {
  const path = join(dir, 'manifest.json')
  if (!existsSync(path)) return null
  return parseManifest(JSON.parse(readFileSync(path, 'utf8')))
}

export function fuzzEntries(manifest: FixtureManifest, dir = fixturesDir()): FuzzEntry[] {
  const fixtures = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]))
  const entries: FuzzEntry[] = manifest.fixtures
    .filter((fixture) => fixture.skipped === null)
    .map((fixture) => ({ kind: 'fixture', id: fixture.id, path: join(dir, fixture.file), fixture }))
  for (const mutation of manifest.mutations) {
    const source = fixtures.get(mutation.sourceId)
    if (source === undefined) throw new Error(`mutation ${mutation.id} references unknown fixture ${mutation.sourceId}`)
    entries.push({ kind: 'mutation', id: mutation.id, path: join(dir, mutation.file), mutation, source })
  }
  return entries
}
