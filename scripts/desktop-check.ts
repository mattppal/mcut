import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..')

function packagedBinary(): string {
  switch (process.platform) {
    case 'linux':
      return join(REPO_ROOT, 'apps/desktop/release/linux-unpacked/mcut-studio')
    case 'darwin':
      if (process.arch === 'arm64') return join(REPO_ROOT, 'apps/desktop/release/mac-arm64/mcut Studio.app/Contents/MacOS/mcut Studio')
      return join(REPO_ROOT, 'apps/desktop/release/mac/mcut Studio.app/Contents/MacOS/mcut Studio')
    default:
      throw new Error('desktop:check supports linux and darwin.')
  }
}

async function run(cmd: string[]): Promise<void> {
  console.log(cmd.join(' '))
  const proc = Bun.spawn(cmd, { cwd: REPO_ROOT, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  const code = await proc.exited
  if (code !== 0) process.exit(code ?? 1)
}

async function main(): Promise<void> {
  await run([process.execPath, 'run', 'turbo', 'run', 'build', 'typecheck', '--filter=mcut-desktop'])
  await run([process.execPath, 'x', 'oxlint', '--deny-warnings', 'apps/desktop', 'scripts', 'packages/desktop-ipc'])
  await run([process.execPath, 'run', '--cwd', 'apps/desktop', 'package'])
  await run(['node', 'apps/desktop/scripts/smoke-packaged.ts', packagedBinary()])
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
