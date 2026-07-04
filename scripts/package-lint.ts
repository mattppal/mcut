import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './lib/exec'
import { discoverPublicPackages, packTarball, repoRoot } from './lib/packages'

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'mcut-package-lint-'))
  try {
    for (const { dir } of await discoverPublicPackages()) {
      const tarball = packTarball(dir, tempRoot)
      run(['bunx', 'publint', 'run', tarball, '--strict'], { cwd: repoRoot })
      run(['bunx', 'attw', tarball, '--profile', 'esm-only', '--format', 'table', '--no-emoji'], {
        cwd: repoRoot,
      })
      console.log(`package lint ok: ${dir.replace(`${repoRoot}/`, '')}`)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
