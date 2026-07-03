export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
}

export interface RunResult {
  success: boolean
  stdout: string
  stderr: string
}

function spawn(command: string[], options: RunOptions): RunResult {
  const proc = Bun.spawnSync(command, {
    cwd: options.cwd ?? process.cwd(),
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

/** Run a command, throwing with its output on failure. */
export function run(command: string[], options: RunOptions = {}): string {
  const result = spawn(command, options)
  if (!result.success) {
    throw new Error(
      [
        `Command failed in ${options.cwd ?? process.cwd()}: ${command.join(' ')}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  return result.stdout
}

/** Run a command and report the outcome instead of throwing. */
export function tryRun(command: string[], options: RunOptions = {}): RunResult {
  return spawn(command, options)
}
