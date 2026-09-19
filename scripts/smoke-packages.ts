import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { run, tryRun } from './lib/exec'
import { discoverPublicPackages, packTarball, repoRoot, type PackageManifest } from './lib/packages'

interface PackedPackage {
  name: string
  version: string
  dir: string
  tarball: string
}

interface StoppableProcess {
  kill(signal?: NodeJS.Signals): void
  exited: Promise<number>
  readonly exitCode: number | null
}

async function inspectPackedManifest(tarball: string): Promise<PackageManifest> {
  const json = run(['tar', '-xOf', tarball, 'package/package.json'], { cwd: repoRoot })
  const manifest = JSON.parse(json) as PackageManifest
  const encoded = JSON.stringify({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies,
  })
  if (encoded.includes('workspace:')) {
    throw new Error(`${manifest.name ?? tarball} packed with unresolved workspace: dependency`)
  }
  return manifest
}

async function packPackages(destination: string): Promise<PackedPackage[]> {
  const packed: PackedPackage[] = []
  for (const { dir, manifest } of await discoverPublicPackages()) {
    if (manifest.name !== 'mcut' && !manifest.name?.startsWith('@mcut/')) {
      throw new Error(`${dir} is public but not in the mcut npm scope: ${manifest.name}`)
    }
    const tarball = packTarball(dir, destination)
    const packedManifest = await inspectPackedManifest(tarball)
    if (!packedManifest.name || !packedManifest.version) {
      throw new Error(`${tarball} packed without name/version`)
    }
    packed.push({ name: packedManifest.name, version: packedManifest.version, dir, tarball })
  }
  return packed.sort((a, b) => a.name.localeCompare(b.name))
}

function smokeProgram(): string {
  return `
import { createProject, EditorEngine, parseProject } from '@mcut/timeline'
import { createEditorOperatorRegistry, registerCoreOperators } from '@mcut/editor'
import { renderFrame } from '@mcut/compositor'
import { listContainerFormats } from '@mcut/media'
import { EditorProvider, PlayerCanvas } from '@mcut/react'
import { toSrt, buildApplyCaptionsCommand } from '@mcut/transcription'
import { normalizeAISDKResult } from '@mcut/transcription-ai-sdk'
import { normalizeAssemblyAIResult } from '@mcut/transcription-assemblyai'
import { planChunks } from '@mcut/transcription-local'
import { lintProject } from '@mcut/cli'
import { createMcutMcpServer } from '@mcut/mcp-server'
import { MCP_AGENT_TOOL_DEFINITIONS } from '@mcut/mcp-server/contract'

const project = parseProject(createProject())
const engine = new EditorEngine(project)
const operators = registerCoreOperators(createEditorOperatorRegistry())
if (operators.list().length === 0) throw new Error('no editor operators registered')
if (typeof renderFrame !== 'function') throw new Error('renderFrame missing')
if (listContainerFormats().length === 0) throw new Error('container formats missing')
if (typeof EditorProvider !== 'function' || typeof PlayerCanvas !== 'function') throw new Error('react exports missing')
if (!toSrt([{ index: 1, startMs: 0, endMs: 1000, text: 'hello' }]).includes('hello')) throw new Error('srt failed')
if (typeof buildApplyCaptionsCommand !== 'function') throw new Error('caption command helper missing')
if (normalizeAISDKResult({ text: 'hi', segments: [], language: undefined, durationInSeconds: undefined }).text !== 'hi') {
  throw new Error('ai sdk normalization failed')
}
if (normalizeAssemblyAIResult({ text: 'hi' }).text !== 'hi') throw new Error('assemblyai normalization failed')
if (planChunks(12).length !== 1) throw new Error('local transcription chunk planner failed')
if (!Array.isArray(lintProject(project))) throw new Error('lintProject did not return issues')
if (!createMcutMcpServer({ engine })) throw new Error('mcp server factory failed')
if (MCP_AGENT_TOOL_DEFINITIONS.length === 0) throw new Error('mcp contract subpath missing')
console.log('mcut package smoke ok')
`
}

function browserSmokeProgram(): string {
  return `
import { exportProject, getExportSupport } from '@mcut/media'
import { MCP_AGENT_TOOL_DEFINITIONS } from '@mcut/mcp-server/contract'
import { createLocalWhisperProvider, planChunks } from '@mcut/transcription-local'

if (typeof exportProject !== 'function') throw new Error('exportProject missing')
if (typeof getExportSupport !== 'function') throw new Error('getExportSupport missing')
if (typeof createLocalWhisperProvider !== 'function') throw new Error('local whisper provider missing')
if (planChunks(12).length !== 1) throw new Error('planChunks missing')
if (MCP_AGENT_TOOL_DEFINITIONS.length === 0) throw new Error('mcp contract subpath not browser-safe')
console.log('mcut browser package smoke ok')
`
}

function exampleDirNames(): string[] {
  return ['agentic-editing', 'headless-editing', 'mcp-server']
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isJsonRecord(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') record[key] = entry
  }
  return record
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isJsonRecord(parsed)) {
    throw new Error(`${path} is not a JSON object`)
  }
  return parsed
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = { FORCE_COLOR: '0' }
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'AI_GATEWAY_API_KEY' || value === undefined) continue
    env[key] = value
  }
  return env
}

function shouldCopyExamplePath(root: string, source: string): boolean {
  const rel = source.slice(root.length)
  return !rel.split(/[\\/]/).some((part) => part === 'node_modules' || part === 'out')
}

async function stopProcess(proc: StoppableProcess): Promise<void> {
  if (proc.exitCode !== null) {
    await proc.exited
    return
  }
  proc.kill('SIGTERM')
  const exited = await Promise.race([proc.exited, Bun.sleep(1000).then(() => null)])
  if (exited === null) {
    proc.kill('SIGKILL')
    await proc.exited
  }
}

async function prepareExample(name: string, packed: PackedPackage[], scratch: string): Promise<string> {
  const from = join(repoRoot, 'examples', name)
  const to = join(scratch, name)
  await cp(from, to, {
    recursive: true,
    filter: (source) => shouldCopyExamplePath(from, source),
  })
  const manifestPath = join(to, 'package.json')
  const manifest = await readJsonObject(manifestPath)
  const dependencies = stringRecord(manifest.dependencies)
  const overrides = stringRecord(manifest.overrides)
  for (const pkg of packed) {
    const spec = `file:${resolve(pkg.tarball)}`
    overrides[pkg.name] = spec
    if (Object.hasOwn(dependencies, pkg.name)) {
      dependencies[pkg.name] = spec
    }
  }
  manifest.dependencies = dependencies
  manifest.overrides = overrides
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const install = tryRun(['bun', 'install'], { cwd: to, env: childEnv() })
  if (!install.success) {
    throw new Error([install.stdout, install.stderr].filter(Boolean).join('\n'))
  }
  return to
}

async function serveExample(cwd: string): Promise<string | null> {
  const ready = 'mcut MCP server ready'
  const proc = Bun.spawn(['bun', 'run', 'index.ts'], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: childEnv(),
  })
  const decoder = new TextDecoder()
  let text = ''
  const ingest = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      text += decoder.decode(chunk)
    }
  }
  void ingest(proc.stdout)
  void ingest(proc.stderr)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (text.includes(ready)) {
      await stopProcess(proc)
      return null
    }
    if (proc.exitCode !== null) {
      return text || `mcp-server exited ${proc.exitCode}`
    }
    await Bun.sleep(25)
  }
  await stopProcess(proc)
  if (text.includes(ready)) return null
  return `mcp-server timed out waiting for ${ready}\n${text}`
}

async function smokeExample(name: string, packed: PackedPackage[], scratch: string): Promise<string | null> {
  try {
    const cwd = await prepareExample(name, packed, scratch)
    if (name === 'mcp-server') return await serveExample(cwd)
    const result = tryRun(['bun', 'run', 'index.ts'], { cwd, env: childEnv() })
    if (result.success) return null
    return [result.stdout, result.stderr].filter(Boolean).join('\n')
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function smokeExamples(packed: PackedPackage[], scratch: string): Promise<void> {
  await mkdir(scratch, { recursive: true })
  const failures: string[] = []
  for (const name of exampleDirNames()) {
    const detail = await smokeExample(name, packed, scratch)
    if (detail === null) {
      console.log(`${name} ok`)
      continue
    }
    console.log(`${name} failed`)
    process.stderr.write(`${detail}\n`)
    failures.push(name)
  }
  if (failures.length > 0) {
    throw new Error(`${failures.join(', ')} failed`)
  }
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'mcut-package-smoke-'))
  const packDir = join(tempRoot, 'packs')
  const consumerDir = join(tempRoot, 'consumer')
  try {
    await Bun.$`mkdir -p ${packDir} ${consumerDir}`.quiet()
    const packed = await packPackages(packDir)
    const dependencies: Record<string, string> = {
      ai: '^6.0.0',
      react: '^19.2.0',
      'react-dom': '^19.2.0',
    }
    const overrides: Record<string, string> = {}
    for (const pkg of packed) {
      const spec = `file:${pkg.tarball}`
      dependencies[pkg.name] = spec
      overrides[pkg.name] = spec
    }

    await writeFile(
      join(consumerDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'mcut-package-smoke-consumer',
          private: true,
          type: 'module',
          dependencies,
          overrides,
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(join(consumerDir, 'smoke.mjs'), smokeProgram())
    await writeFile(join(consumerDir, 'browser-smoke.ts'), browserSmokeProgram())

    run(['bun', 'install'], { cwd: consumerDir })
    const output = run(['bun', 'smoke.mjs'], { cwd: consumerDir })
    process.stdout.write(output)
    run(['bun', 'build', 'browser-smoke.ts', '--target=browser', '--outdir=dist-browser'], {
      cwd: consumerDir,
    })
    await smokeExamples(packed, join(tempRoot, 'examples'))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
