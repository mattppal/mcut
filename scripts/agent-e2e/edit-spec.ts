import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { assertKnownCheck } from './edit-checks'
import type { ToolCall } from './types'

export type Capability = 'exists' | 'partial' | 'missing'

export type FailureCause = 'agent-misuse' | 'tool-error' | 'missing-capability'

export interface EditStep {
  id: string
  ask: string
  checks: string[]
  capability: Capability
  note: string
}

export interface EditSpec {
  media: string[]
  place: string[]
  edits: EditStep[]
}

export class EditSpecError extends Error {}

const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.wav', '.mp3', '.m4a', '.aac', '.flac', '.png', '.jpg', '.jpeg'])

const VALIDATION_ERROR = /invalid|expected|required|unknown tool|unrecognized|not found|does not exist|no element|no asset|zod|must be/i

const CANNOT =
  /\b(cannot|can't|can not|unable|not (?:possible|supported|available)|no (?:tool|way|support)|doesn't support|does not support|isn't supported|lack)/i

const stepSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  ask: z.string().min(1),
  checks: z.array(z.string()).default(['changed']),
  capability: z.enum(['exists', 'partial', 'missing']).default('exists'),
  note: z.string().default(''),
})

const specSchema = z.object({
  media: z.array(z.string()).default([]),
  place: z.array(z.string()).default([]),
  edits: z.array(stepSchema).min(1),
})

const slug = (text: string, index: number): string =>
  `${String(index + 1).padStart(2, '0')}-${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)}`

function readDocument(file: string): unknown {
  const raw = readFileSync(file, 'utf8')
  if (/\.ya?ml$/.test(file)) return Bun.YAML.parse(raw)
  const edits = raw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((ask) => ({ ask }))
  return { edits }
}

function mediaIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => MEDIA_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(dir, name))
}

export function loadEditSpec(file: string, mediaDir: string | undefined): EditSpec {
  const parsed = specSchema.safeParse(readDocument(file))
  if (!parsed.success) throw new EditSpecError(`${file} is not a valid edit list. ${parsed.error.message}`)
  const base = mediaDir ?? dirname(file)
  const listed = parsed.data.media.map((entry) => (isAbsolute(entry) ? entry : resolve(base, entry)))
  const media = listed.length > 0 ? listed : mediaDir !== undefined ? mediaIn(mediaDir) : []
  const missing = media.filter((path) => !existsSync(path))
  if (missing.length > 0) throw new EditSpecError(`media not found: ${missing.join(', ')}`)
  const edits = parsed.data.edits.map((step, index): EditStep => {
    step.checks.forEach(assertKnownCheck)
    return { id: step.id ?? slug(step.ask, index), ask: step.ask, checks: step.checks, capability: step.capability, note: step.note }
  })
  return { media, place: parsed.data.place, edits }
}

export function classifyFailure(step: EditStep, calls: ToolCall[], finalMessage: string): FailureCause {
  const errors = calls.filter((call) => call.isError)
  const internal = errors.filter((call) => !VALIDATION_ERROR.test(call.result))
  if (internal.length > 0) return 'tool-error'
  if (step.capability === 'missing' || CANNOT.test(finalMessage)) return 'missing-capability'
  return 'agent-misuse'
}
