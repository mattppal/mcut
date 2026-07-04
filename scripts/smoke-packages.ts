import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './lib/exec'
import { discoverPublicPackages, packTarball, repoRoot, type PackageManifest } from './lib/packages'

interface PackedPackage {
  name: string
  version: string
  dir: string
  tarball: string
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
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
