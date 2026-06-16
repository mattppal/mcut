import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface PackageJson {
  name?: string
  version?: string
  private?: boolean
}

interface PublishedPackage {
  name: string
  version: string
}

const root = resolve(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')
const registry = process.env.GITHUB_PACKAGES_REGISTRY ?? 'https://npm.pkg.github.com'
const tag = process.env.GITHUB_PACKAGES_TAG ?? 'alpha'
const token = process.env.GITHUB_PACKAGES_TOKEN ?? process.env.NODE_AUTH_TOKEN ?? process.env.GITHUB_TOKEN
const dryRun = process.argv.includes('--dry-run')
const publishAll = process.argv.includes('--all')

function fail(message: string): never {
  throw new Error(message)
}

function run(command: string[], options: { cwd?: string; env?: Record<string, string> } = {}): string {
  const proc = Bun.spawnSync(command, {
    cwd: options.cwd ?? root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...options.env,
      FORCE_COLOR: '0',
    },
  })
  const stdout = proc.stdout.toString()
  const stderr = proc.stderr.toString()
  if (!proc.success) {
    throw new Error([`Command failed: ${command.join(' ')}`, stdout, stderr].filter(Boolean).join('\n'))
  }
  return stdout
}

function tryRun(command: string[], options: { cwd?: string; env?: Record<string, string> } = {}): {
  success: boolean
  stdout: string
  stderr: string
} {
  const proc = Bun.spawnSync(command, {
    cwd: options.cwd ?? root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...options.env,
      FORCE_COLOR: '0',
    },
  })
  return {
    success: proc.success,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

async function readJson(path: string): Promise<PackageJson> {
  return (await Bun.file(path).json()) as PackageJson
}

async function publicPackageDirsByName(): Promise<Map<string, string>> {
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const dirs = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = await readJson(manifestPath)
    if (manifest.private || !manifest.name) continue
    dirs.set(manifest.name, dir)
  }
  return dirs
}

async function allPublishedPackages(dirsByName: Map<string, string>): Promise<PublishedPackage[]> {
  const packages: PublishedPackage[] = []
  for (const [name, dir] of dirsByName) {
    const manifest = await readJson(join(dir, 'package.json'))
    if (!manifest.version) fail(`${name} is missing package.json version`)
    packages.push({ name, version: manifest.version })
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name))
}

function publishedPackagesFromEnv(): PublishedPackage[] {
  const raw = process.env.PUBLISHED_PACKAGES
  if (!raw) fail('PUBLISHED_PACKAGES is required unless --all is passed')
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) fail('PUBLISHED_PACKAGES must be a JSON array')
  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') fail('PUBLISHED_PACKAGES entries must be objects')
    const candidate = entry as Partial<PublishedPackage>
    if (typeof candidate.name !== 'string') fail('PUBLISHED_PACKAGES entry is missing name')
    if (typeof candidate.version !== 'string') fail(`${candidate.name} is missing version`)
    return { name: candidate.name, version: candidate.version }
  })
}

function npmEnv(npmrcPath: string): Record<string, string> {
  return {
    GITHUB_PACKAGES_TOKEN: token ?? '',
    NPM_CONFIG_USERCONFIG: npmrcPath,
  }
}

function isNotFound(output: string): boolean {
  return /\bE404\b|404 Not Found|not found/i.test(output)
}

function packageVersionExists(pkg: PublishedPackage, npmrcPath: string): boolean {
  const result = tryRun(
    ['npm', 'view', `${pkg.name}@${pkg.version}`, 'version', '--registry', registry, '--userconfig', npmrcPath],
    { env: npmEnv(npmrcPath) },
  )
  if (result.success) return true
  const output = `${result.stdout}\n${result.stderr}`
  if (isNotFound(output)) return false
  throw new Error([`Could not check ${pkg.name}@${pkg.version} in GitHub Packages`, output].join('\n'))
}

async function main(): Promise<void> {
  if (!token && !dryRun) fail('GITHUB_PACKAGES_TOKEN, NODE_AUTH_TOKEN, or GITHUB_TOKEN is required')

  const dirsByName = await publicPackageDirsByName()
  const packages = publishAll ? await allPublishedPackages(dirsByName) : publishedPackagesFromEnv()
  if (packages.length === 0) {
    console.log('No packages to mirror to GitHub Packages')
    return
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'mcut-github-packages-'))
  const npmrcPath = join(tempRoot, '.npmrc')
  await writeFile(
    npmrcPath,
    [
      '@mcut:registry=https://npm.pkg.github.com',
      '//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}',
      'always-auth=true',
      '',
    ].join('\n'),
  )

  try {
    for (const pkg of packages) {
      const dir = dirsByName.get(pkg.name)
      if (!dir) fail(`${pkg.name} is not a public package in packages/*`)
      const manifest = await readJson(join(dir, 'package.json'))
      if (manifest.version !== pkg.version) {
        fail(`${pkg.name} manifest version is ${manifest.version}, expected ${pkg.version}`)
      }

      if (!dryRun && packageVersionExists(pkg, npmrcPath)) {
        console.log(`GitHub Packages already has ${pkg.name}@${pkg.version}; skipping`)
        continue
      }

      const command = [
        'npm',
        'publish',
        dir,
        '--registry',
        registry,
        '--tag',
        tag,
        '--provenance=false',
        '--userconfig',
        npmrcPath,
      ]
      if (dryRun) command.push('--dry-run')
      run(command, { env: npmEnv(npmrcPath) })
      console.log(`Mirrored ${pkg.name}@${pkg.version} to GitHub Packages`)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
