/**
 * Copies the publishable parts of the skill (SKILL.md, references/, assets/)
 * into the Studio app's .well-known directory, where they are served as static
 * files alongside the existing `mcut` integration skill.
 */
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SKILL = join(import.meta.dir, '..')
const DEST = join(SKILL, '../../apps/studio/public/.well-known/agent-skills/mcut-editing')
const INDEX = join(SKILL, '../../apps/studio/public/.well-known/agent-skills/index.json')

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
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`
}

function frontmatterValue(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) throw new Error(`Missing ${key} in SKILL.md frontmatter.`)
  return match[1]!.trim()
}

async function syncIndex(): Promise<void> {
  const content = await readFile(join(DEST, 'SKILL.md'), 'utf8')
  const raw = await readFile(INDEX, 'utf8')
  const index = JSON.parse(raw) as SkillIndex
  const entry: SkillIndexEntry = {
    name: frontmatterValue(content, 'name'),
    type: 'skill-md',
    description: frontmatterValue(content, 'description'),
    url: '/.well-known/agent-skills/mcut-editing/SKILL.md',
    digest: await digest(join(DEST, 'SKILL.md')),
  }
  const entries = new Map(index.skills.map((skill) => [skill.name, skill]))
  entries.set(entry.name, entry)
  index.skills = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
  await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

await rm(DEST, { recursive: true, force: true })
await mkdir(DEST, { recursive: true })
await cp(join(SKILL, 'SKILL.md'), join(DEST, 'SKILL.md'))
await cp(join(SKILL, 'references'), join(DEST, 'references'), { recursive: true })
await cp(join(SKILL, 'assets'), join(DEST, 'assets'), { recursive: true })
await syncIndex()
console.log(`synced skill → ${DEST}`)
