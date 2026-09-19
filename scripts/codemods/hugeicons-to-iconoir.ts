import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { run } from '../lib/exec'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const studioRoot = join(repoRoot, 'apps', 'studio')
const oldModule = '@/lib/hugeicons'
const newModule = '@/lib/icons'
const oldModuleFile = 'lib/hugeicons.tsx'
const newModuleFile = 'lib/icons.ts'
const oldPackages = ['@hugeicons/react', '@hugeicons/core-free-icons']
const newPackage = 'iconoir-react'

const skipDirs = new Set(['node_modules', '.next', 'public'])

function listSourceFiles(): string[] {
  const output = run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], {
    cwd: studioRoot,
  })
  return output
    .split('\0')
    .filter((rel) => /\.(ts|tsx)$/.test(rel))
    .filter(
      (rel) =>
        !rel
          .split('/')
          .slice(0, -1)
          .some((dir) => skipDirs.has(dir)),
    )
    .filter((rel) => existsSync(join(studioRoot, rel)))
    .sort()
}

function rewriteImports(): { files: number; specifiers: number } {
  const pattern = new RegExp(`(["'])${oldModule}\\1`, 'g')
  let files = 0
  let specifiers = 0
  for (const rel of listSourceFiles()) {
    const path = join(studioRoot, rel)
    const text = readFileSync(path, 'utf8')
    const matches = text.match(pattern)
    if (!matches) continue
    writeFileSync(path, text.replace(pattern, `$1${newModule}$1`))
    files += 1
    specifiers += matches.length
    console.log(`rewrote ${matches.length} import(s) in apps/studio/${rel}`)
  }
  return { files, specifiers }
}

const registrySchema = z.looseObject({
  items: z.array(
    z.looseObject({
      name: z.string(),
      dependencies: z.array(z.string()).optional(),
      files: z.array(z.looseObject({ path: z.string() })).optional(),
    }),
  ),
})

function rewriteRegistry(): number {
  const path = join(studioRoot, 'registry.json')
  const before = readFileSync(path, 'utf8')
  const names = oldPackages.join('|')
  const pair = new RegExp(`"(?:${names})",\\s*"(?:${names})"`, 'g')
  const single = new RegExp(`"(?:${names})"`, 'g')
  const after = before.replace(pair, `"${newPackage}"`).replace(single, `"${newPackage}"`).replaceAll(`"${oldModuleFile}"`, `"${newModuleFile}"`)
  const parsed: unknown = JSON.parse(after)
  const registry = registrySchema.parse(parsed)
  let touched = 0
  for (const item of registry.items) {
    const dependencies = item.dependencies ?? []
    if (new Set(dependencies).size !== dependencies.length) {
      throw new Error(`registry item ${item.name} lists a dependency twice after the rewrite`)
    }
    const files = item.files ?? []
    const mentionsIcons = dependencies.includes(newPackage) || files.some((file) => file.path === newModuleFile)
    if (mentionsIcons) touched += 1
  }
  if (after.includes('hugeicons')) throw new Error('registry.json still mentions hugeicons after the rewrite')
  if (after !== before) writeFileSync(path, after)
  return touched
}

function removeOldModule(): boolean {
  const oldPath = join(studioRoot, oldModuleFile)
  if (!existsSync(oldPath)) return false
  if (!existsSync(join(studioRoot, newModuleFile))) {
    throw new Error(`${newModuleFile} is missing, write the icon table before removing ${oldModuleFile}`)
  }
  unlinkSync(oldPath)
  return true
}

function main(): void {
  const imports = rewriteImports()
  const registryItems = rewriteRegistry()
  const removed = removeOldModule()
  console.log(
    [
      `imports: ${imports.specifiers} specifier(s) in ${imports.files} file(s) now point at ${newModule}`,
      `registry.json: ${registryItems} item(s) depend on ${newPackage} and ship ${newModuleFile}`,
      `old module: ${removed ? `removed apps/studio/${oldModuleFile}` : 'already gone'}`,
      `left for you: bun remove ${oldPackages.join(' ')} in apps/studio, then bun run build there to regenerate public/r`,
    ].join('\n'),
  )
}

main()
