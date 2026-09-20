import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SKILL = join(import.meta.dir, '..')
const DEST = join(SKILL, '../../apps/web/public/.well-known/agent-skills')
const STUDIO_MIRROR = join(SKILL, '../../apps/studio/public/.well-known/agent-skills')

interface SkillIndexEntry {
  name: string
  type: string
  description: string
  url: string
  digest: string
}

interface SkillIndex {
  $schema: string
  skills: SkillIndexEntry[]
}

async function digest(path: string): Promise<string> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`
}

function frontmatterValue(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) throw new Error(`Missing ${key} in SKILL.md frontmatter.`)
  return match[1]!.trim()
}

async function syncIndex(root: string, skillDir: string): Promise<void> {
  const indexPath = join(root, 'index.json')
  const content = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  const raw = await readFile(indexPath, 'utf8')
  const index = JSON.parse(raw) as SkillIndex
  const entry: SkillIndexEntry = {
    name: frontmatterValue(content, 'name'),
    type: 'skill-md',
    description: frontmatterValue(content, 'description'),
    url: '/.well-known/agent-skills/mcut-editing/SKILL.md',
    digest: await digest(join(skillDir, 'SKILL.md')),
  }
  const entries = new Map(index.skills.map((skill) => [skill.name, skill]))
  entries.set(entry.name, entry)
  index.skills = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

async function syncInto(root: string): Promise<void> {
  const skillDir = join(root, 'mcut-editing')
  await rm(skillDir, { recursive: true, force: true })
  await mkdir(skillDir, { recursive: true })
  await cp(join(SKILL, 'SKILL.md'), join(skillDir, 'SKILL.md'))
  await cp(join(SKILL, 'references'), join(skillDir, 'references'), { recursive: true })
  await cp(join(SKILL, 'assets'), join(skillDir, 'assets'), { recursive: true })
  await syncIndex(root, skillDir)
  console.log(`synced skill to ${skillDir}`)
}

for (const root of [DEST, STUDIO_MIRROR]) await syncInto(root)
