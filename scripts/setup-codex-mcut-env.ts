import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import { localEditorBridgeUrl, localMcpUrl } from './mcut-local-dev'

const root = process.cwd()
const codexDir = resolve(root, '.codex')
const agentsSkillsDir = resolve(root, '.agents', 'skills')
const editingSkillSource = resolve(root, 'skills', 'mcut-editing')
const editingSkillLink = resolve(agentsSkillsDir, 'mcut-editing')

function posixPath(value: string): string {
  return value.split('\\').join('/')
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function lstatIfExists(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function ensureEditingSkill(): void {
  if (!existsSync(editingSkillSource)) {
    throw new Error(`Missing source skill: ${editingSkillSource}`)
  }

  const target = posixPath(relative(agentsSkillsDir, editingSkillSource))
  const stat = lstatIfExists(editingSkillLink)
  if (stat) {
    if (stat.isSymbolicLink() && readlinkSync(editingSkillLink) === target) return
    if (stat.isDirectory() && existsSync(resolve(editingSkillLink, 'SKILL.md'))) {
      rmSync(editingSkillLink, { recursive: true, force: true })
      cpSync(editingSkillSource, editingSkillLink, { recursive: true })
      return
    }
    throw new Error(
      `${editingSkillLink} already exists and is not the expected symlink to ${target}.`,
    )
  }

  try {
    symlinkSync(target, editingSkillLink, 'dir')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      cpSync(editingSkillSource, editingSkillLink, { recursive: true })
      return
    }
    throw error
  }
}

function writeCodexConfig(): void {
  const config = `approval_policy = "never"

[mcp_servers.mcut-live]
url = "${localMcpUrl()}"
startup_timeout_sec = 20
tool_timeout_sec = 300
default_tools_approval_mode = "approve"
`

  writeFileSync(resolve(codexDir, 'config.toml'), config)
}

ensureDir(codexDir)
ensureDir(agentsSkillsDir)

try {
  ensureEditingSkill()
} catch (error) {
  if (lstatIfExists(editingSkillLink)?.isSymbolicLink()) {
    unlinkSync(editingSkillLink)
    ensureEditingSkill()
  } else {
    throw error
  }
}

writeCodexConfig()

console.log('Configured worktree-local Codex environment for mcut.')
console.log(`- MCP: mcut-live connects to ${localMcpUrl()}`)
console.log('- Skill: mcut-editing available in .agents/skills')
console.log('')
console.log('Local workflow:')
console.log('1. bun run dev')
console.log(`2. Open ${localEditorBridgeUrl()}`)
console.log('3. Trust this project in Codex and enable the mcut-live MCP server')
console.log('')
console.log('Tip: run `bun run scripts/mcut-local-dev.ts url` to print the current editor URL.')
