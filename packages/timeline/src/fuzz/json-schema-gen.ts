import { z } from 'zod'
import type { Rng } from './rng'

export type SlotKind = 'track' | 'element' | 'asset' | 'marker' | 'layout' | 'preset'

export interface Slot {
  $slot: SlotKind
  index: number
}

export type ArgTemplate = unknown

export type Overrides = Record<string, (rng: Rng) => ArgTemplate>

export interface GenerateOptions {
  overrides?: Overrides
  wrongTypeRate?: number
}

const SLOT_KINDS: readonly SlotKind[] = ['track', 'element', 'asset', 'marker', 'layout', 'preset']

export interface JsonObject {
  [key: string]: unknown
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const jsonSchemaShape = z
  .object({
    type: z.string().optional(),
    anyOf: z.array(z.unknown()).optional(),
    oneOf: z.array(z.unknown()).optional(),
    enum: z.array(z.unknown()).optional(),
    const: z.unknown().optional(),
    pattern: z.string().optional(),
    minLength: z.number().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    items: z.unknown().optional(),
    prefixItems: z.array(z.unknown()).optional(),
    minItems: z.number().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.unknown().optional(),
    propertyNames: z.object({ enum: z.array(z.string()).optional() }).optional(),
  })
  .loose()

type JsonSchema = z.infer<typeof jsonSchemaShape>

export function isSlot(value: unknown): value is Slot {
  if (!isRecord(value)) return false
  const kind = value.$slot
  return typeof kind === 'string' && SLOT_KINDS.some((known) => known === kind) && typeof value.index === 'number'
}

type LeafKind = 'enum' | 'const' | 'string' | 'integer' | 'number' | 'boolean' | 'null'
type SchemaKind = LeafKind | 'any' | 'branches' | 'object' | 'array'

interface Context {
  overrides: Overrides
  wrongTypeRate: number
  key: string | undefined
}

type Generator = (schema: JsonSchema, rng: Rng, context: Context) => ArgTemplate

const EXTREME_RATE = 0.05
const OPTIONAL_RATE = 0.35
const DOMAIN_MAX = 20000
const SMALL_BOUND = 10000
const MAX_ITEMS = 3
const MAX_RECORD_KEYS = 2
const SLOT_INDEX_MAX = 7

const TYPED_KINDS: readonly SchemaKind[] = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']
const LEAF_KINDS: readonly LeafKind[] = ['enum', 'const', 'string', 'integer', 'number', 'boolean', 'null']

const WORDS = ['clip', 'intro', 'camera', 'screen', 'Hello world', '#ff8800', 'rgba(0, 0, 0, 0.5)', 'sans-serif', 'b-roll']
const RECORD_KEYS = ['opacity', 'volume', 'startMs', 'text', 'radius', 'enabled', 'name', 'extra']

const idPrefixes: Record<string, SlotKind | null> = { t: 'track', e: 'element', a: 'asset', m: 'marker', g: null }

const keySlotRules: ReadonlyArray<{ test: RegExp; kind: SlotKind }> = [
  { test: /layoutId$/, kind: 'layout' },
  { test: /presetId$/, kind: 'preset' },
]

const wrongType: Record<LeafKind, (rng: Rng) => ArgTemplate> = {
  enum: () => 'not-an-option',
  const: () => 'not-the-const',
  string: (rng) => rng.int(0, 99),
  integer: () => 'twelve',
  number: () => 'twelve',
  boolean: () => 'yes',
  null: () => 0,
}

const generators: Record<SchemaKind, Generator> = {
  any: () => null,
  branches: (schema, rng, context) => generate(rng.pick(schema.anyOf ?? schema.oneOf ?? []), rng, context),
  enum: (schema, rng) => rng.pick(schema.enum ?? []),
  const: (schema) => schema.const,
  boolean: (_schema, rng) => rng.chance(0.5),
  null: () => null,
  integer: (schema, rng) => numeric(schema, rng, true),
  number: (schema, rng) => numeric(schema, rng, false),
  string: stringValue,
  array: arrayValue,
  object: objectValue,
}

export function generateArgs(schema: unknown, rng: Rng, options: GenerateOptions = {}): ArgTemplate {
  return generate(schema, rng, {
    overrides: options.overrides ?? {},
    wrongTypeRate: options.wrongTypeRate ?? 0,
    key: undefined,
  })
}

function generate(schema: unknown, rng: Rng, context: Context): ArgTemplate {
  const override = context.key === undefined ? undefined : context.overrides[context.key]
  if (override) return override(rng)
  const parsed = jsonSchemaShape.safeParse(schema)
  if (!parsed.success) return null
  const kind = kindOf(parsed.data)
  if (isLeaf(kind) && rng.chance(context.wrongTypeRate)) return wrongType[kind](rng)
  return generators[kind](parsed.data, rng, context)
}

function kindOf(schema: JsonSchema): SchemaKind {
  if (schema.anyOf || schema.oneOf) return 'branches'
  if (schema.enum) return 'enum'
  if ('const' in schema) return 'const'
  return TYPED_KINDS.find((kind) => kind === schema.type) ?? 'any'
}

function isLeaf(kind: SchemaKind): kind is LeafKind {
  return LEAF_KINDS.some((leaf) => leaf === kind)
}

function stringValue(schema: JsonSchema, rng: Rng, context: Context): ArgTemplate {
  const key = context.key ?? ''
  const keyRule = keySlotRules.find((rule) => rule.test.test(key))
  if (keyRule) return slot(keyRule.kind, rng)
  const prefix = idPrefixOf(schema.pattern)
  if (prefix !== undefined) {
    const kind = idPrefixes[prefix]
    if (key === 'id' || kind === null || kind === undefined) return freshId(prefix, rng)
    return slot(kind, rng)
  }
  const minLength = schema.minLength ?? 0
  const word = rng.pick(WORDS)
  return word.length >= minLength ? word : word.padEnd(minLength, 'x')
}

function idPrefixOf(pattern: string | undefined): string | undefined {
  if (pattern === undefined) return undefined
  const match = /^\^([a-z]+)-/.exec(pattern)
  return match?.[1]
}

function slot(kind: SlotKind, rng: Rng): Slot {
  return { $slot: kind, index: rng.int(0, SLOT_INDEX_MAX) }
}

function freshId(prefix: string, rng: Rng): string {
  return `${prefix}-fz${rng.int(0, 0xffffff).toString(16).padStart(6, '0')}`
}

function numeric(schema: JsonSchema, rng: Rng, integer: boolean): number {
  const { exclusiveMinimum, maximum } = schema
  const minimum = schema.minimum ?? (exclusiveMinimum === undefined ? undefined : exclusiveMinimum + (integer ? 1 : 0.001))
  if (rng.chance(EXTREME_RATE)) return extreme(rng, integer, minimum, maximum)
  const smallBounded = minimum !== undefined && maximum !== undefined && maximum <= SMALL_BOUND
  const lo = smallBounded ? minimum : Math.max(minimum ?? 0, -DOMAIN_MAX)
  const hi = Math.max(lo, smallBounded ? maximum : Math.min(maximum ?? DOMAIN_MAX, DOMAIN_MAX))
  const value = integer ? rng.int(lo, hi) : round3(lo + rng.next() * (hi - lo))
  if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) return exclusiveMinimum + (integer ? 1 : 0.5)
  return value
}

function extreme(rng: Rng, integer: boolean, minimum: number | undefined, maximum: number | undefined): number {
  const candidates = [0, -rng.int(1, 1000)]
  if (minimum !== undefined) candidates.push(minimum)
  if (maximum !== undefined && maximum <= SMALL_BOUND) candidates.push(maximum)
  if (integer) candidates.push(rng.int(0, 100) + 0.5)
  return rng.pick(candidates)
}

function arrayValue(schema: JsonSchema, rng: Rng, context: Context): ArgTemplate {
  if (schema.prefixItems) return schema.prefixItems.map((item) => generate(item, rng, context))
  const minItems = schema.minItems ?? 0
  const count = rng.int(minItems, Math.max(MAX_ITEMS, minItems))
  return Array.from({ length: count }, () => generate(schema.items, rng, context))
}

function objectValue(schema: JsonSchema, rng: Rng, context: Context): ArgTemplate {
  const result: JsonObject = {}
  const properties = schema.properties ?? {}
  const required = schema.required ?? []
  for (const [key, property] of Object.entries(properties)) {
    if (required.includes(key) || rng.chance(OPTIONAL_RATE)) result[key] = generate(property, rng, { ...context, key })
  }
  const additional = schema.additionalProperties
  if (additional !== undefined && additional !== false) {
    const names = propertyNames(schema)
    const count = rng.int(0, MAX_RECORD_KEYS)
    for (let i = 0; i < count; i++) {
      const key = rng.pick(names)
      result[key] = generate(additional, rng, { ...context, key })
    }
  }
  return result
}

function propertyNames(schema: JsonSchema): string[] {
  const names = schema.propertyNames?.enum ?? []
  return names.length > 0 ? names : RECORD_KEYS
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
