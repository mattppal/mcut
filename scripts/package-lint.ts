import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface PackageJson {
  name?: string
  private?: boolean
}

const root = resolve(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')

function run(command: string[], cwd: string): string {
  const proc = Bun.spawnSync(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  })
  const stdout = proc.stdout.toString()
  const stderr = proc.stderr.toString()
  if (!proc.success) {
    throw new Error(
      [`Command failed in ${cwd}: ${command.join(' ')}`, stdout, stderr].filter(Boolean).join('\n'),
    )
  }
  return stdout
}

async function readJson(path: string): Promise<PackageJson> {
  return (await Bun.file(path).json()) as PackageJson
}

async function publicPackageDirs(): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifest = await readJson(join(dir, 'package.json'))
    if (manifest.private) continue
    if (!manifest.name) continue
    dirs.push(dir)
  }
  return dirs.sort()
}

function packedTarballFrom(output: string): string {
  const tarball = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.endsWith('.tgz'))
  if (!tarball) throw new Error(`Could not determine packed tarball from:\n${output}`)
  return tarball
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'mcut-package-lint-'))
  try {
    for (const dir of await publicPackageDirs()) {
      const output = run(['bun', 'pm', 'pack', '--destination', tempRoot, '--quiet'], dir)
      const tarball = packedTarballFrom(output)
      run(['bunx', 'publint', 'run', tarball, '--strict'], root)
      run(['bunx', 'attw', tarball, '--profile', 'esm-only', '--format', 'table', '--no-emoji'], root)
      console.log(`package lint ok: ${dir.replace(`${root}/`, '')}`)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
