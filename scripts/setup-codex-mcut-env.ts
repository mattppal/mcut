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

const root = process.cwd()
const codexDir = resolve(root, '.codex')
const agentsSkillsDir = resolve(root, '.agents', 'skills')
const contextDir = resolve(root, '.context')
const editingSkillSource = resolve(root, 'skills', 'mcut-editing')
const editingSkillLink = resolve(agentsSkillsDir, 'mcut-editing')
const projectPath = '.context/mcut-project.mcut.json'
const liveBridgeToken = 'mcut-local-dev'

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

[mcp_servers.mcut]
command = "bun"
args = ["packages/mcp-server/src/cli.ts", "${projectPath}"]
cwd = "${posixPath(root)}"
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "approve"

[mcp_servers.mcut-live]
command = "bun"
args = [
  "packages/mcp-server/src/live-cli.ts",
  "--port",
  "54319",
  "--token",
  "${liveBridgeToken}",
  "--editor-url",
  "http://localhost:3000/editor",
]
cwd = "${posixPath(root)}"
startup_timeout_sec = 20
tool_timeout_sec = 300
default_tools_approval_mode = "approve"
`

  writeFileSync(resolve(codexDir, 'config.toml'), config)
}

ensureDir(codexDir)
ensureDir(agentsSkillsDir)
ensureDir(contextDir)

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
console.log('- MCP: mcut file-backed project tools')
console.log('- MCP: mcut-live browser bridge tools')
console.log('- Skill: mcut-editing available in .agents/skills')
