import { z } from 'zod'
import { effectSchema } from '../effects'
import { elementInputSchema, type Project } from '../model'
import { TRANSITION_TYPES } from '../transitions'
import {
  generateArgs,
  isRecord,
  isSlot,
  type ArgTemplate,
  type Overrides,
  type Slot,
  type SlotKind,
} from './json-schema-gen'
import { Rng } from './rng'

export type Seed = number

export interface StepTemplate {
  tool: string
  args: ArgTemplate
}

export interface Plan {
  seed: Seed
  steps: StepTemplate[]
}

export interface FuzzTool {
  name: string
  inputSchema: unknown
}

export interface GeneratePlanOptions {
  seed: Seed
  tools: readonly FuzzTool[]
  length: number
  overrides?: Overrides
}

const MALFORMED_STEP_RATE = 0.05
const MALFORMED_LEAF_RATE = 0.3
const WARMUP_STEPS = 10
const growthWeights: Record<string, number> = { addElement: 6, addAsset: 3, addTrack: 1, addMarker: 1 }

function weightedPool(tools: readonly FuzzTool[], baseWeight: number): FuzzTool[] {
  return tools.flatMap((tool) => Array.from({ length: growthWeights[tool.name] ?? baseWeight }, () => tool))
}

export function generatePlan({ seed, tools, length, overrides }: GeneratePlanOptions): Plan {
  const rng = new Rng(seed)
  const warmup = weightedPool(tools, 0)
  const steady = weightedPool(tools, 1)
  const steps: StepTemplate[] = []
  for (let i = 0; i < length; i++) {
    const tool = rng.pick(i < WARMUP_STEPS && warmup.length > 0 ? warmup : steady)
    const wrongTypeRate = rng.chance(MALFORMED_STEP_RATE) ? MALFORMED_LEAF_RATE : 0
    steps.push({ tool: tool.name, args: generateArgs(tool.inputSchema, rng, { overrides, wrongTypeRate }) })
  }
  return { seed, steps }
}

const slotCandidates: Record<SlotKind, (project: Project) => string[]> = {
  track: (project) => project.tracks.map((track) => track.id),
  element: (project) => project.tracks.flatMap((track) => track.elements.map((element) => element.id)),
  asset: (project) => Object.keys(project.assets),
  marker: (project) => project.markers.map((marker) => marker.id),
  layout: (project) => project.layouts.map((layout) => layout.id),
  preset: (project) => project.presets.map((preset) => preset.id),
}

const missingId: Record<SlotKind, string> = {
  track: 't-missing',
  element: 'e-missing',
  asset: 'a-missing',
  marker: 'm-missing',
  layout: 'lay-missing',
  preset: 'ps-missing',
}

export function resolveArgs(template: ArgTemplate, project: Project): unknown {
  if (isSlot(template)) return resolveSlot(template, project)
  if (Array.isArray(template)) return template.map((item) => resolveArgs(item, project))
  if (isRecord(template)) {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, resolveArgs(value, project)]))
  }
  return template
}

function resolveSlot(slot: Slot, project: Project): string {
  const candidates = slotCandidates[slot.$slot](project)
  return candidates[slot.index % candidates.length] ?? missingId[slot.$slot]
}

const jsonSchemas = new Map<z.ZodType, unknown>()

function jsonSchemaOf(schema: z.ZodType): unknown {
  let json = jsonSchemas.get(schema)
  if (json === undefined) {
    json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' })
    jsonSchemas.set(schema, json)
  }
  return json
}

export function effectTemplate(rng: Rng): ArgTemplate {
  return generateArgs(jsonSchemaOf(effectSchema), rng)
}

function transitionTemplate(rng: Rng): ArgTemplate {
  return { type: rng.pick(TRANSITION_TYPES), durationMs: rng.int(100, 5000) }
}

function timeMapTemplate(rng: Rng): ArgTemplate {
  const frames: Array<{ timeMs: number; value: number }> = []
  let timeMs = 0
  let value = 0
  for (let i = rng.int(2, 4); i > 0; i--) {
    frames.push({ timeMs, value })
    timeMs += rng.int(1, 5000)
    value += rng.int(0, 5000)
  }
  return frames
}

function cropTemplate(rng: Rng): ArgTemplate {
  const x = rng.int(0, 90) / 100
  const y = rng.int(0, 90) / 100
  return { x, y, w: rng.int(1, Math.round((1 - x) * 100)) / 100, h: rng.int(1, Math.round((1 - y) * 100)) / 100 }
}

const refinedShapes: Overrides = {
  transition: transitionTemplate,
  angleTransition: transitionTemplate,
  timeMap: timeMapTemplate,
  crop: cropTemplate,
  effect: effectTemplate,
  effects: (rng) => Array.from({ length: rng.int(0, 2) }, () => effectTemplate(rng)),
}

const elementOverrides: Overrides = {
  ...refinedShapes,
  startMs: (rng) => rng.int(0, 20000),
  durationMs: (rng) => rng.int(10, 5000),
}

export function elementTemplate(rng: Rng): ArgTemplate {
  return generateArgs(jsonSchemaOf(elementInputSchema), rng, { overrides: elementOverrides })
}

export const commandOverrides: Overrides = { ...refinedShapes, element: elementTemplate }
