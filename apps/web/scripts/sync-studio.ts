import { access, cp, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const appRoot = process.cwd()
const repoRoot = path.resolve(appRoot, '../..')
const studioOut = path.join(repoRoot, 'apps/studio/out')
const webOut = path.join(appRoot, 'out')
const EMBED_PAGES = ['embed.html', 'embed.txt']

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function ensureStudioExport(): Promise<void> {
  if (await fileExists(path.join(studioOut, 'embed.html'))) return
  const build = Bun.spawn(['bun', 'run', 'build', '--filter=mcut-studio'], {
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await build.exited
  if (exitCode !== 0) throw new Error(`mcut-studio build exited with ${exitCode}`)
  if (!(await fileExists(path.join(studioOut, 'embed.html')))) throw new Error(`mcut-studio build left no ${path.join(studioOut, 'embed.html')}`)
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(full)))
    else files.push(full)
  }
  return files
}

async function copyPages(): Promise<number> {
  let copied = 0
  for (const name of EMBED_PAGES) {
    const source = path.join(studioOut, name)
    if (!(await fileExists(source))) continue
    await cp(source, path.join(webOut, name))
    copied += 1
  }
  return copied
}

async function mergeStatic(): Promise<number> {
  const sourceRoot = path.join(studioOut, '_next/static')
  const targetRoot = path.join(webOut, '_next/static')
  let copied = 0
  for (const source of await listFiles(sourceRoot)) {
    const target = path.join(targetRoot, path.relative(sourceRoot, source))
    if (await fileExists(target)) {
      const [sourceBytes, targetBytes] = await Promise.all([readFile(source), readFile(target)])
      if (sourceBytes.equals(targetBytes)) continue
      throw new Error(`sync-studio: ${source} and ${target} differ, refusing to overwrite`)
    }
    await mkdir(path.dirname(target), { recursive: true })
    await cp(source, target)
    copied += 1
  }
  return copied
}

await ensureStudioExport()
const copied = (await copyPages()) + (await mergeStatic())
console.log(`sync-studio: copied ${copied} files into ${path.relative(appRoot, webOut)}`)
