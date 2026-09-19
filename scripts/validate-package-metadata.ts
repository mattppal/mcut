import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { discoverPublicPackages, repoRoot, type PackageManifest, type PublicPackage } from './lib/packages'

const rootLicense = await readFile(join(repoRoot, 'LICENSE'), 'utf8')

function fail(message: string): never {
  throw new Error(message)
}

function requireField(condition: unknown, pkg: string, field: string): void {
  if (!condition) fail(`${pkg} is missing required npm metadata: ${field}`)
}

function validateBinTargets(pkg: PackageManifest, dir: string): void {
  if (!pkg.bin || typeof pkg.bin === 'string') return
  for (const [name, target] of Object.entries(pkg.bin)) {
    if (!target.startsWith('./dist/')) fail(`${pkg.name} bin ${name} must point at ./dist`)
    const sourceTarget = target.replace('./dist/', './src/').replace(/\.js$/, '.ts')
    if (!existsSync(join(dir, sourceTarget))) fail(`${pkg.name} bin ${name} has no source entry at ${sourceTarget}`)
  }
}

async function validatePackage({ dir, manifest: pkg }: PublicPackage): Promise<void> {
  const label = pkg.name ?? join(dir, 'package.json')

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

for (const pkg of await discoverPublicPackages()) {
  await validatePackage(pkg)
}

console.log('package metadata ok')
