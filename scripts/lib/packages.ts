import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { run } from './exec'

/** The union of package.json fields the release scripts read. */
export interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  description?: string
  license?: string
  type?: string
  author?: string
  homepage?: string
  bugs?: { url?: string }
  keywords?: string[]
  repository?: { type?: string; url?: string; directory?: string }
  publishConfig?: { access?: string; provenance?: boolean }
  files?: string[]
  main?: string
  types?: string
  exports?: unknown
  bin?: Record<string, string> | string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface PublicPackage {
  dir: string
  manifest: PackageManifest
}

export const repoRoot = resolve(import.meta.dirname, '..', '..')
const packagesDir = join(repoRoot, 'packages')

export async function readPackageJson(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

/** Every named, non-private package under packages/, sorted by directory. */
export async function discoverPublicPackages(): Promise<PublicPackage[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const packages: PublicPackage[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = await readPackageJson(manifestPath)
    if (manifest.private || !manifest.name) continue
    packages.push({ dir, manifest })
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir))
}

/** `bun pm pack` a package into `destination` and return the tarball path. */
export function packTarball(dir: string, destination: string): string {
  const output = run(['bun', 'pm', 'pack', '--destination', destination, '--quiet'], { cwd: dir })
  const tarball = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.endsWith('.tgz'))
  if (!tarball) throw new Error(`Could not determine packed tarball for ${dir} from:\n${output}`)
  return tarball
}
