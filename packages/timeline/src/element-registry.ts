import { z } from 'zod'

/**
 * The element-type registry — mcut's ShapeUtil. An element type is a
 * vocabulary entry in the document: its zod schemas (composed with the
 * shared id/timing fields by `registerTimelineElementType` in model.ts),
 * which fixed-effect properties animate, and the behavior hooks the engine
 * consults (split, validation, summaries, frame decoding).
 *
 * The built-in types register through this exact API, so custom types are
 * first-class: they parse in saved projects, split correctly, keyframe, and
 * appear in agent summaries. Renderers live in @mcut/compositor's renderer
 * registry and UI chrome in the webapp's element-ui registry — same `type`
 * key, layered packages.
 *
 * Register custom types at module load, before parsing or editing projects.
 */

export interface ElementTypeEntry {
  type: string
  /** Composed schema: { id, type, timing…, …own fields }. */
  fullSchema: z.ZodType
  /** Same with `id` optional (generated on insert). */
  inputSchema: z.ZodType
  /** Fixed-effect properties this type animates (see keyframes.ts). */
  keyframeable: readonly string[]
  /**
   * Adjust the two halves of a split (mutate the draft copies). The engine
   * has already divided `keyframes` continuously and set the halves' timing;
   * implement source bookkeeping here (advancing trims, dividing a timeMap,
   * splitting a word list).
   */
  onSplit?: (context: {
    element: Record<string, unknown>
    left: Record<string, unknown>
    right: Record<string, unknown>
    offsetMs: number
  }) => void
  /** Validate against the project (throw CommandError-likes to reject). */
  validate?: (project: unknown, element: Record<string, unknown>) => void
  /** One-line agent-facing description (summarizeProject). */
  describe?: (element: Record<string, unknown>, project: unknown) => string
  /** Decode requests for a frame — the render/decode parity seam. */
  frameRequests?: (
    project: unknown,
    element: Record<string, unknown>,
    timelineMs: number,
  ) => Array<{ assetId: string; sourceTimeMs: number }>
}

const registry = new Map<string, ElementTypeEntry>()
let version = 0

export function registerElementTypeEntry(entry: ElementTypeEntry): void {
  if (registry.has(entry.type)) {
    throw new Error(`element type "${entry.type}" is already registered`)
  }
  registry.set(entry.type, entry)
  version += 1
}

export function getElementType(type: string): ElementTypeEntry | undefined {
  return registry.get(type)
}

export function listElementTypes(): ElementTypeEntry[] {
  return [...registry.values()]
}

// ---------------------------------------------------------------------------
// Dynamic unions: rebuilt when the registry grows, cached otherwise.
// ---------------------------------------------------------------------------

interface UnionCache {
  version: number
  full: z.ZodType
  input: z.ZodType
}

let cache: UnionCache | null = null

function unions(): UnionCache {
  if (!cache || cache.version !== version) {
    const entries = listElementTypes()
    if (entries.length === 0) {
      throw new Error('no element types registered (import order bug)')
    }
    cache = {
      version,
      full: z.discriminatedUnion(
        'type',
        entries.map((e) => e.fullSchema) as never,
      ) as unknown as z.ZodType,
      input: z.discriminatedUnion(
        'type',
        entries.map((e) => e.inputSchema) as never,
      ) as unknown as z.ZodType,
    }
  }
  return cache
}

/**
 * A schema that re-resolves the union on every parse, so types registered
 * after module load still validate. Issues from the underlying union pass
 * through untouched.
 */
function dynamicUnion(pick: (u: UnionCache) => z.ZodType): z.ZodType {
  return z.any().transform((value, ctx) => {
    const result = pick(unions()).safeParse(value)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue } as Parameters<typeof ctx.addIssue>[0])
      }
      return z.NEVER
    }
    return result.data
  })
}

/** Every registered element type, `id` required. */
export const anyElementSchema: z.ZodType = dynamicUnion((u) => u.full)
/** Every registered element type, `id` optional (generated on insert). */
export const anyElementInputSchema: z.ZodType = dynamicUnion((u) => u.input)
