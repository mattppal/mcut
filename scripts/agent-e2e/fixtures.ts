import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'

export const repoRoot = resolve(import.meta.dirname, '..', '..')

const MANIFEST_PATH = 'fixtures/media/manifest.json'

const FALLBACK_PATH = 'apps/studio/e2e/fixtures/fixture-vp9.mkv'

const fixtureSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['video', 'audio', 'image']).default('video'),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  fps: z.number().positive().default(30),
})

const manifestSchema = z.object({ fixtures: z.array(fixtureSchema) })

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
  fps: number
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

function readManifest(): Map<string, Fixture> {
  const file = join(repoRoot, MANIFEST_PATH)
  if (!existsSync(file)) return new Map()
  const parsed = manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  return new Map(
    parsed.fixtures.map((entry): [string, Fixture] => [
      entry.id,
      {
        ...entry,
        absolutePath: join(repoRoot, entry.path),
        name: basename(entry.path),
        source: 'manifest',
      },
    ]),
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
