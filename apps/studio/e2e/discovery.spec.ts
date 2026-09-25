import { createHash } from 'node:crypto'
import { z } from 'zod'
import { expect, test, type Page } from './electron-fixture'

const AGENT_TOOL_NAMES = [
  'get_summary',
  'get_project',
  'get_media_context',
  'get_audio_activity',
  'get_transcript',
  'search_transcript',
  'ensure_transcript',
  'ensure_voice_stems',
  'list_commands',
  'apply_commands',
  'apply_captions',
  'apply_silence_cuts',
  'lint_project',
  'list_zooms',
  'edit_zooms',
  'list_presets',
  'list_operators',
  'run_operator',
  'list_actions',
  'run_action',
  'transact',
  'undo',
  'redo',
  'export_video',
  'get_export',
  'cancel_export',
]

const FULL_TOOL_COUNT = 130
const STUDIO_ORIGIN = 'app://studio'

const toolCatalogSchema = z.object({
  profile: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.object({ type: z.string(), properties: z.record(z.string(), z.unknown()) }),
    }),
  ),
})

const skillIndexSchema = z.object({
  skills: z.array(z.object({ name: z.string(), type: z.string(), url: z.string(), digest: z.string() })),
})

function fetchJson(page: Page, pathname: string): Promise<{ ok: boolean; body: unknown }> {
  return page.evaluate(async (url): Promise<{ ok: boolean; body: unknown }> => {
    const response = await fetch(url)
    return { ok: response.ok, body: await response.json() }
  }, `${STUDIO_ORIGIN}${pathname}`)
}

async function fetchBytes(page: Page, pathname: string): Promise<{ ok: boolean; body: Buffer }> {
  const { ok, base64 } = await page.evaluate(async (url) => {
    const response = await fetch(url)
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return { ok: response.ok, base64: btoa(binary) }
  }, `${STUDIO_ORIGIN}${pathname}`)
  return { ok, body: Buffer.from(base64, 'base64') }
}

test('serves the curated agent profile at /tools.json and every command under ?profile=full', async ({ page }) => {
  const res = await fetchJson(page, '/tools.agent.json')
  expect(res.ok).toBe(true)
  const agent = toolCatalogSchema.parse(res.body)
  expect(agent.profile).toBe('agent')
  expect(
    agent.tools.map((tool) => tool.name),
    'MCP_AGENT_TOOL_NAMES in @mcut/mcp-server/contract',
  ).toEqual(AGENT_TOOL_NAMES)

  const fullRes = await fetchJson(page, '/tools.full.json')
  expect(fullRes.ok).toBe(true)
  const full = toolCatalogSchema.parse(fullRes.body)
  expect(full.profile).toBe('full')
  expect(full.tools.length, '26 agent tools (23 server static + 3 bridge only) + 43 editor operators + 61 timeline commands').toBe(FULL_TOOL_COUNT)
  const split = full.tools.find((tool) => tool.name === 'splitElement')
  expect(split?.description).toContain('Split')
  expect(split?.inputSchema.type).toBe('object')
  expect(Object.keys(split?.inputSchema.properties ?? {})).toContain('elementId')
})

test('renders the human-readable tool catalog at /tools', async ({ page }) => {
  await page.goto(`${STUDIO_ORIGIN}/tools`)
  await expect(page.getByRole('heading', { name: /MCP tools/ })).toHaveText(new RegExp(`\\(${AGENT_TOOL_NAMES.length}\\)`))
  await expect(page.getByText('apply_commands', { exact: true })).toBeVisible()

  await page.goto(`${STUDIO_ORIGIN}/tools?profile=full`)
  await expect(page.getByRole('heading', { name: /MCP tools/ })).toHaveText(new RegExp(`\\(${FULL_TOOL_COUNT}\\)`))
  await expect(page.getByText('splitElement', { exact: true })).toBeVisible()
})

// The /.well-known/ prefix for site metadata is defined by RFC 8615. https://www.rfc-editor.org/rfc/rfc8615
test('hosts the mcut agent skill under /.well-known/agent-skills', async ({ page }) => {
  const indexRes = await fetchJson(page, '/.well-known/agent-skills/index.json')
  expect(indexRes.ok).toBe(true)
  const index = skillIndexSchema.parse(indexRes.body)
  const skill = index.skills.find((entry) => entry.name === 'mcut')
  if (!skill) throw new Error(`index.json lists no skill named mcut, only ${index.skills.map((entry) => entry.name).join(', ')}`)
  expect(skill.type).toBe('skill-md')

  const skillRes = await fetchBytes(page, skill.url)
  expect(skillRes.ok).toBe(true)
  const body = skillRes.body
  expect(body.toString('utf8')).toContain('name: mcut')

  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`
  expect(digest, 'index.json digest is stale. Regenerate it with shasum -a 256 public/.well-known/agent-skills/mcut/SKILL.md').toBe(skill.digest)
})
