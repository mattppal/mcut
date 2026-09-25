import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { tapLines } from './bridge-session'
import type { AgentTurn } from './grok-build'
import type { Caps, Stop } from './loop'
import type { Prompt } from './model'

const CURSOR_SERVER_NAME = 'mcut'

export const CURSOR_INSTALL_COMMAND = 'curl https://cursor.com/install -fsS | bash'

const AUTH_FAILURE = /authentication required|not logged in|CURSOR_API_KEY|unauthorized|\b401\b/i
const STDERR_TAIL_LINES = 20

export class CursorAgentAuthError extends Error {}

export interface CursorAgentOptions {
  binary: string
  projectDir: string
  runDir: string
  caps: Caps
  model: string | undefined
  log: (line: string) => void
}

const resultEvent = z.object({ type: z.literal('result'), subtype: z.string(), is_error: z.boolean().default(false), result: z.string().default('') })

const toolStarted = z.object({ type: z.literal('tool_call'), subtype: z.literal('started') })

export function findCursorAgentBinary(): string | undefined {
  const explicit = process.env.CURSOR_AGENT_BIN
  if (explicit !== undefined && explicit.length > 0) return existsSync(explicit) ? explicit : undefined
  const onPath = Bun.which('cursor-agent')
  if (onPath !== null) return onPath
  const installed = join(homedir(), '.local/bin/cursor-agent')
  return existsSync(installed) ? installed : undefined
}

export function writeCursorProject(dir: string, mcpUrl: string): string {
  const cursorDir = join(dir, '.cursor')
  mkdirSync(cursorDir, { recursive: true })
  const file = join(cursorDir, 'mcp.json')
  writeFileSync(file, `${JSON.stringify({ mcpServers: { [CURSOR_SERVER_NAME]: { url: mcpUrl } } }, null, 2)}\n`, 'utf8')
  return file
}

export async function runCursorAgentPrompt(id: string, prompt: Prompt, options: CursorAgentOptions): Promise<AgentTurn> {
  const args = [options.binary, '-p', '--output-format', 'stream-json', '--approve-mcps', '--trust', '--force']
  if (options.model !== undefined) args.push('--model', options.model)
  args.push(`${prompt.system}\n\n${prompt.user}`)
  const events = createWriteStream(join(options.runDir, `${id}.cursor.ndjson`))
  const stderr: string[] = []
  let result: z.infer<typeof resultEvent> | undefined
  let steps = 0

  const proc = Bun.spawn(args, {
    cwd: options.projectDir,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: options.caps.wallClockMs,
    killSignal: 'SIGKILL',
  })
  options.log(`${id}: cursor-agent pid ${proc.pid} in ${options.projectDir}`)
  const onStdout = (line: string): void => {
    events.write(`${line}\n`)
    let document: unknown
    try {
      document = JSON.parse(line)
    } catch {
      return
    }
    if (toolStarted.safeParse(document).success) steps += 1
    const parsed = resultEvent.safeParse(document)
    if (parsed.success) result = parsed.data
  }
  const onStderr = (line: string): void => {
    stderr.push(line)
    if (stderr.length > STDERR_TAIL_LINES) stderr.shift()
  }
  await Promise.all([tapLines(proc.stdout, onStdout), tapLines(proc.stderr, onStderr), proc.exited])
  events.end()

  const stop: Stop =
    proc.signalCode === 'SIGKILL'
      ? { stoppedBy: 'wall-clock', detail: 'cursor-agent exceeded the wall clock cap and was killed' }
      : result !== undefined && !result.is_error
        ? { stoppedBy: 'model', detail: result.result }
        : { stoppedBy: 'error', detail: `cursor-agent exited with code ${proc.exitCode}. ${stderr.join('\n')}` }
  if (stop.stoppedBy === 'error' && AUTH_FAILURE.test(stop.detail)) throw new CursorAgentAuthError(`cursor-agent could not authenticate. ${stop.detail}`)
  return { toolCalls: [], stop, steps, tokens: { input: 0, output: 0 }, model: `cursor-agent/${options.model ?? 'default'}` }
}
