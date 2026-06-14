#!/usr/bin/env node
/**
 * mcut on the command line. Every subcommand operates on a project document
 * (JSON) the way the editor does: parse → dispatch commands → persist. Export
 * stays in the browser (WebCodecs); this tool edits the document.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  CommandError,
  EditorEngine,
  ProjectFormatError,
  createProject,
  listToolDefinitions,
  summarizeProject,
  type AnyCommand,
} from '@mcut/timeline'
import { buildCaptionsCommand } from './captions'
import { readProjectFile, readTranscriptFile, writeProjectFile } from './io'
import { lintProject } from './lint'
import { PLATFORM_PRESETS, getPlatformPreset } from './presets'
import { planSilenceCuts } from './silence'

const HELP = `mcut — headless tools for mcut project documents

Usage:
  mcut new [file] [--preset <id>] [--name <name>] [--force]
  mcut validate <file> [--strict]
  mcut summarize <file>
  mcut apply <file> [commands.json] [--dry-run]      (or pipe commands on stdin)
  mcut captions <file> --transcript <t.json> [--element <id>] [--style <id>]
                [--max-chars <n>] [--replace] [--dry-run]
  mcut silence-cuts <file> --transcript <t.json> --element <id>
                [--min-gap <ms>] [--padding <ms>] [--keep-ends] [--dry-run]
  mcut commands [--json] [--name <command>]
  mcut presets [--json]

Commands:
  new            Scaffold a project document from a platform preset (default: youtube).
  validate       Parse + lint a project; exits 1 on errors (--strict: warnings too).
  summarize      Print the compact textual rendering of a project (read this before editing).
  apply          Dispatch a JSON command batch (object or array) as one undo step, then save.
  captions       Add captions from a transcript JSON ({ words: [{ text, startMs, endMs }] }).
  silence-cuts   Cut transcript silence out of one element (splits + ripple deletes + edge trims).
  commands       List every editing command; --name prints one command's JSON schema.
  presets        List platform presets (dimensions, fps, safe areas).
`

class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function parseCommandBatch(raw: string): AnyCommand[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail('commands input is not valid JSON')
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  for (const item of list) {
    if (typeof item !== 'object' || item === null || typeof (item as AnyCommand).type !== 'string') {
      fail('each command must be an object with a string "type"')
    }
  }
  return list as AnyCommand[]
}

async function cmdNew(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      preset: { type: 'string', default: 'youtube' },
      name: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  })
  const file = positionals[0] ?? 'project.mcut.json'
  const preset = getPlatformPreset(values.preset)
  if (!preset) {
    fail(`unknown preset "${values.preset}" (known: ${PLATFORM_PRESETS.map((p) => p.id).join(', ')})`)
  }
  if (existsSync(file) && !values.force) fail(`${file} already exists (use --force to overwrite)`)
  const project = createProject({
    name: values.name ?? 'Untitled',
    width: preset.width,
    height: preset.height,
    fps: preset.fps,
  })
  await writeProjectFile(file, project)
  console.log(`Created ${file} — ${preset.label}, ${preset.width}x${preset.height}@${preset.fps}`)
}

async function cmdValidate(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { strict: { type: 'boolean', default: false } },
  })
  const file = positionals[0] ?? fail('validate needs a project file')
  const project = await readProjectFile(file)
  const issues = lintProject(project)
  for (const issue of issues) {
    console.log(`${issue.severity}[${issue.code}]: ${issue.message}`)
  }
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  console.log(
    issues.length === 0
      ? `OK: ${file} is valid`
      : `${file}: ${errors} error(s), ${warnings} warning(s)`,
  )
  if (errors > 0 || (values.strict && warnings > 0)) process.exitCode = 1
}

async function cmdSummarize(argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} })
  const file = positionals[0] ?? fail('summarize needs a project file')
  console.log(summarizeProject(await readProjectFile(file)))
}

async function cmdApply(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { 'dry-run': { type: 'boolean', default: false } },
  })
  const file = positionals[0] ?? fail('apply needs a project file')
  const source = positionals[1]
  const raw = source && source !== '-' ? await readFile(source, 'utf8') : await readStdin()
  const commands = parseCommandBatch(raw)
  const engine = new EditorEngine({ project: await readProjectFile(file) })
  engine.transact(() => {
    for (const command of commands) engine.dispatch(command)
  })
  if (!values['dry-run']) await writeProjectFile(file, engine.project)
  console.log(
    `${values['dry-run'] ? '(dry run) ' : ''}Applied ${commands.length} command(s) to ${file}\n`,
  )
  console.log(summarizeProject(engine.project))
}

async function cmdCaptions(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      transcript: { type: 'string' },
      element: { type: 'string' },
      style: { type: 'string' },
      'max-chars': { type: 'string' },
      replace: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const file = positionals[0] ?? fail('captions needs a project file')
  if (!values.transcript) fail('captions needs --transcript <file>')
  const project = await readProjectFile(file)
  const transcript = await readTranscriptFile(values.transcript)
  const command = buildCaptionsCommand(project, transcript, {
    ...(values.element ? { elementId: values.element } : {}),
    ...(values.style ? { styleId: values.style } : {}),
    ...(values['max-chars'] ? { maxChars: Number(values['max-chars']) } : {}),
    replace: values.replace,
  })
  if (values['dry-run']) {
    console.log(JSON.stringify(command, null, 2))
    return
  }
  const engine = new EditorEngine({ project })
  engine.dispatch(command)
  await writeProjectFile(file, engine.project)
  const count = (command.captions as unknown[]).length
  console.log(`Added ${count} caption(s) to ${file}\n`)
  console.log(summarizeProject(engine.project))
}

async function cmdSilenceCuts(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      transcript: { type: 'string' },
      element: { type: 'string' },
      'min-gap': { type: 'string' },
      padding: { type: 'string' },
      'keep-ends': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const file = positionals[0] ?? fail('silence-cuts needs a project file')
  if (!values.transcript) fail('silence-cuts needs --transcript <file>')
  if (!values.element) fail('silence-cuts needs --element <id>')
  const project = await readProjectFile(file)
  const transcript = await readTranscriptFile(values.transcript)
  const plan = planSilenceCuts(project, values.element, transcript, {
    ...(values['min-gap'] ? { minGapMs: Number(values['min-gap']) } : {}),
    ...(values.padding ? { paddingMs: Number(values.padding) } : {}),
    trimEnds: !values['keep-ends'],
  })
  if (plan.silences.length === 0) {
    console.log('No silences found — nothing to cut.')
    return
  }
  if (values['dry-run']) {
    console.log(JSON.stringify({ silences: plan.silences, commands: plan.commands }, null, 2))
    return
  }
  await writeProjectFile(file, plan.project)
  console.log(
    `Cut ${plan.silences.length} silence(s), ${(plan.removedMs / 1000).toFixed(2)}s removed\n`,
  )
  console.log(summarizeProject(plan.project))
}

async function cmdCommands(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: 'boolean', default: false }, name: { type: 'string' } },
  })
  const tools = listToolDefinitions()
  if (values.name) {
    const tool = tools.find((t) => t.name === values.name)
    if (!tool) fail(`unknown command "${values.name}"`)
    console.log(JSON.stringify(tool, null, 2))
    return
  }
  if (values.json) {
    console.log(JSON.stringify(tools, null, 2))
    return
  }
  for (const tool of tools) console.log(`${tool.name} — ${tool.description}`)
}

async function cmdPresets(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean', default: false } } })
  if (values.json) {
    console.log(JSON.stringify(PLATFORM_PRESETS, null, 2))
    return
  }
  for (const preset of PLATFORM_PRESETS) {
    console.log(`${preset.id} — ${preset.label}, ${preset.width}x${preset.height}@${preset.fps}`)
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'new':
      return cmdNew(rest)
    case 'validate':
      return cmdValidate(rest)
    case 'summarize':
      return cmdSummarize(rest)
    case 'apply':
      return cmdApply(rest)
    case 'captions':
      return cmdCaptions(rest)
    case 'silence-cuts':
      return cmdSilenceCuts(rest)
    case 'commands':
      return cmdCommands(rest)
    case 'presets':
      return cmdPresets(rest)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      return
    default:
      fail(`unknown command "${command}" — run \`mcut help\``)
  }
}

main().catch((error) => {
  if (error instanceof CommandError || error instanceof ProjectFormatError) {
    console.error(`${error.name} (${error.code}): ${error.message}`)
  } else if (error instanceof CliError) {
    console.error(`mcut: ${error.message}`)
  } else {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exitCode = 1
})
