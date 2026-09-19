import { z } from 'zod'
import type { TimelineElement, Track, Project } from './model'
import { isElementActiveAt } from './selectors'

export const transitionTypeSchema = z.enum([
  'dissolve',
  'fade-black',
  'fade-white',
  'slide-left',
  'slide-right',
  'wipe-left',
  'wipe-right',
])

export type TransitionType = z.infer<typeof transitionTypeSchema>

export const TRANSITION_TYPES: readonly TransitionType[] = transitionTypeSchema.options

export const MIN_TRANSITION_DURATION_MS = 100

export const transitionSchema = z.object({
  type: transitionTypeSchema,
  durationMs: z.number().int().min(MIN_TRANSITION_DURATION_MS).max(5000).default(500),
})

export type Transition = z.infer<typeof transitionSchema>

export interface TransitionPair {
  left: TimelineElement
  right: TimelineElement
  cutMs: number
  durationMs: number
  type: TransitionType
}

const hasTransition = (
  element: TimelineElement,
): element is TimelineElement & { transition: Transition } =>
  'transition' in element && element.transition !== undefined

export function getTransitionPair(track: Track, left: TimelineElement): TransitionPair | null {
  if (!hasTransition(left)) return null
  const cutMs = left.startMs + left.durationMs
  const right = track.elements.find((e) => e.startMs === cutMs && e.id !== left.id)
  if (!right) return null
  const durationMs = Math.min(left.transition.durationMs, left.durationMs, right.durationMs)
  return { left, right, cutMs, durationMs, type: left.transition.type }
}

export function getActiveTransitionPairs(track: Track, timeMs: number): TransitionPair[] {
  const pairs: TransitionPair[] = []
  for (const element of track.elements) {
    if (element.startMs > timeMs) break
    const pair = getTransitionPair(track, element)
    if (!pair) continue
    const half = pair.durationMs / 2
    if (timeMs >= pair.cutMs - half && timeMs < pair.cutMs + half) pairs.push(pair)
  }
  return pairs
}

export function getTransitionCompletion(pair: TransitionPair, timeMs: number): number {
  const half = pair.durationMs / 2
  return Math.min(1, Math.max(0, (timeMs - (pair.cutMs - half)) / pair.durationMs))
}

export interface RenderableElement {
  track: Track
  element: TimelineElement
  reason: 'active' | 'transition-tail' | 'transition-head'
}

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
