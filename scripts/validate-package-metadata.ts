import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface PackageJson {
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
}

const root = resolve(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')
const rootLicense = await readFile(join(root, 'LICENSE'), 'utf8')

function fail(message: string): never {
  throw new Error(message)
}

function requireField(condition: unknown, pkg: string, field: string): void {
  if (!condition) fail(`${pkg} is missing required npm metadata: ${field}`)
}

async function readJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageJson
}

async function publicPackageDirs(): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = await readJson(manifestPath)
    if (manifest.private) continue
    if (!manifest.name) continue
    dirs.push(dir)
  }
  return dirs.sort()
}

function validateBinTargets(pkg: PackageJson, dir: string): void {
  if (!pkg.bin || typeof pkg.bin === 'string') return
  for (const [name, target] of Object.entries(pkg.bin)) {
    if (!target.startsWith('./dist/')) fail(`${pkg.name} bin ${name} must point at ./dist`)
    const sourceTarget = target.replace('./dist/', './src/').replace(/\.js$/, '.ts')
    if (!existsSync(join(dir, sourceTarget))) fail(`${pkg.name} bin ${name} has no source entry at ${sourceTarget}`)
  }
}

async function validatePackage(dir: string): Promise<void> {
  const manifestPath = join(dir, 'package.json')
  const pkg = await readJson(manifestPath)
  const label = pkg.name ?? manifestPath

  requireField(pkg.name, label, 'name')
  requireField(pkg.version, label, 'version')
  requireField(pkg.description, label, 'description')
  requireField(pkg.license === 'Apache-2.0', label, 'license: Apache-2.0')
  requireField(pkg.type === 'module', label, 'type: module')
  requireField(pkg.author, label, 'author')
  requireField(pkg.homepage?.startsWith('https://github.com/'), label, 'homepage')
  requireField(pkg.bugs?.url?.startsWith('https://github.com/'), label, 'bugs.url')
  requireField(pkg.keywords && pkg.keywords.length >= 4, label, 'keywords')
  requireField(pkg.repository?.type === 'git', label, 'repository.type')
  requireField(pkg.repository?.url?.startsWith('https://github.com/'), label, 'repository.url')
  requireField(pkg.repository?.directory, label, 'repository.directory')
  requireField(pkg.publishConfig?.access === 'public', label, 'publishConfig.access')
  requireField(pkg.publishConfig?.provenance === true, label, 'publishConfig.provenance')
  requireField(pkg.files?.includes('dist'), label, 'files: dist')
  requireField(pkg.main === './dist/index.js', label, 'main')
  requireField(pkg.types === './dist/index.d.ts', label, 'types')
  requireField(pkg.exports, label, 'exports')

  if (!existsSync(join(dir, 'README.md'))) fail(`${label} is missing package README.md`)
  if (!existsSync(join(dir, 'LICENSE'))) fail(`${label} is missing package LICENSE`)
  const packageLicense = await readFile(join(dir, 'LICENSE'), 'utf8')
  if (packageLicense !== rootLicense) fail(`${label} LICENSE differs from root LICENSE`)

  validateBinTargets(pkg, dir)
}

for (const dir of await publicPackageDirs()) {
  await validatePackage(dir)
}

console.log('package metadata ok')
