import { z } from 'zod'
import type { TimelineElement, Track, Project } from './model'
import { isElementActiveAt } from './selectors'

/**
 * Clip transitions as a 2-reference mixer: the LEFT clip of an adjacent pair
 * carries `{ type, durationMs }`, and the renderer blends the pair across a
 * window centered on the cut (Kdenlive same-track-mix semantics: clips stay
 * butt-cut; the left clip renders past its out point and the right clip
 * pre-rolls before its in point, consuming trim handles where they exist).
 *
 * The transition is DATA on the left element; adjacency is re-verified at
 * render time, so moving either clip simply disables the blend rather than
 * corrupting anything.
 */
const transitionRegistry = new Map<string, { type: string; label?: string }>()

/**
 * Register a transition type name (the document-vocabulary half; pair it
 * with registerTransitionRenderer in @mcut/compositor). Built-ins register
 * below through the same call.
 */
export function registerTransitionType(entry: { type: string; label?: string }): void {
  if (transitionRegistry.has(entry.type)) {
    throw new Error(`transition type "${entry.type}" is already registered`)
  }
  transitionRegistry.set(entry.type, entry)
}

/** Registration order = presentation order (transition pickers). */
export function listTransitionTypes(): string[] {
  return [...transitionRegistry.keys()]
}

export const BUILTIN_TRANSITION_TYPES = [
  'dissolve',
  'fade-black',
  'fade-white',
  'slide-left',
  'slide-right',
  'wipe-left',
  'wipe-right',
] as const
for (const type of BUILTIN_TRANSITION_TYPES) registerTransitionType({ type })

/** Dynamic: any registered transition type (custom included). */
export const transitionTypeSchema = z
  .string()
  .refine((type) => transitionRegistry.has(type), {
    message: 'unregistered transition type',
  })

export type TransitionType = (typeof BUILTIN_TRANSITION_TYPES)[number] | (string & {})

/** @deprecated snapshot of the built-ins; prefer listTransitionTypes(). */
export const TRANSITION_TYPES = BUILTIN_TRANSITION_TYPES

export const transitionSchema = z.object({
  type: transitionTypeSchema,
  /** Total blend window, centered on the cut. */
  durationMs: z.number().int().min(100).max(5000).default(500),
})

export type Transition = z.infer<typeof transitionSchema>

export interface TransitionPair {
  left: TimelineElement
  right: TimelineElement
  /** Absolute timeline time of the cut. */
  cutMs: number
  durationMs: number
  type: TransitionType
}

const hasTransition = (
  element: TimelineElement,
): element is TimelineElement & { transition: Transition } =>
  'transition' in element && element.transition !== undefined

/**
 * The verified transition pair anchored on `left`, or null when the clip has
 * no transition or no longer has an exactly-adjacent right neighbor.
 */
export function getTransitionPair(track: Track, left: TimelineElement): TransitionPair | null {
  if (!hasTransition(left)) return null
  const cutMs = left.startMs + left.durationMs
  const right = track.elements.find((e) => e.startMs === cutMs && e.id !== left.id)
  if (!right) return null
  // Clamp the window so it never swallows either whole clip.
  const durationMs = Math.min(left.transition.durationMs, left.durationMs, right.durationMs)
  return { left, right, cutMs, durationMs, type: left.transition.type }
}

/** Transition pairs on `track` whose blend window contains `timeMs`. */
export function getActiveTransitionPairs(track: Track, timeMs: number): TransitionPair[] {
  const pairs: TransitionPair[] = []
  for (const element of track.elements) {
    // Sorted by startMs, and a window never starts before its left clip does
    // (half-width is clamped to the clip durations).
    if (element.startMs > timeMs) break
    const pair = getTransitionPair(track, element)
    if (!pair) continue
    const half = pair.durationMs / 2
    if (timeMs >= pair.cutMs - half && timeMs < pair.cutMs + half) pairs.push(pair)
  }
  return pairs
}

/** Blend completion 0→1 across the pair's window at `timeMs`. */
export function getTransitionCompletion(pair: TransitionPair, timeMs: number): number {
  const half = pair.durationMs / 2
  return Math.min(1, Math.max(0, (timeMs - (pair.cutMs - half)) / pair.durationMs))
}

export interface RenderableElement {
  track: Track
  element: TimelineElement
  /**
   * Why this element renders at this time: normally active, extended past its
   * out point (left of a transition), or pre-rolling before its in point
   * (right of a transition).
   */
  reason: 'active' | 'transition-tail' | 'transition-head'
}

/**
 * Every element that needs pixels at `timeMs` — the active set plus
 * transition partners outside their own ranges. Render paths (compositor,
 * export prepare, preview pool) must all enumerate through this so they
 * agree on what is on screen.
 */
export function getRenderableElements(project: Project, timeMs: number): RenderableElement[] {
  const items: RenderableElement[] = []
  for (const track of project.tracks) {
    const pairs = getActiveTransitionPairs(track, timeMs)
    for (const element of track.elements) {
      if (isElementActiveAt(element, timeMs)) {
        items.push({ track, element, reason: 'active' })
        continue
      }
      for (const pair of pairs) {
        if (pair.left.id === element.id && timeMs >= pair.cutMs) {
          items.push({ track, element, reason: 'transition-tail' })
        } else if (pair.right.id === element.id && timeMs < pair.cutMs) {
          items.push({ track, element, reason: 'transition-head' })
        }
      }
    }
  }
  return items
}
