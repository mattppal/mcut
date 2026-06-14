import { getAnimatedValue } from './keyframes'
import type { TimelineElement } from './model'

/** Structural slice of elements that can carry audio fades. */
export interface FadeableElement {
  durationMs: number
  fadeInMs?: number | undefined
  fadeOutMs?: number | undefined
}

/**
 * Fade multiplier (0..1) at element-local `localMs`: linear ramps over the
 * first `fadeInMs` and last `fadeOutMs` of the clip. Fades longer than the
 * clip clamp to its duration; overlapping ramps take the minimum (a dip, the
 * standard NLE behavior). 1 everywhere when no fades are set.
 */
export function getFadeGain(element: FadeableElement, localMs: number): number {
  const fadeIn = Math.min(element.fadeInMs ?? 0, element.durationMs)
  const fadeOut = Math.min(element.fadeOutMs ?? 0, element.durationMs)
  let gain = 1
  if (fadeIn > 0 && localMs < fadeIn) {
    gain = Math.min(gain, Math.max(0, localMs / fadeIn))
  }
  if (fadeOut > 0 && localMs > element.durationMs - fadeOut) {
    gain = Math.min(gain, Math.max(0, (element.durationMs - localMs) / fadeOut))
  }
  return Math.max(0, Math.min(1, gain))
}

/**
 * The volume that actually plays at an absolute timeline time: the animated
 * (or static) volume scaled by the fade envelope. The single seam preview
 * sync, export mixing, and volume visualizations must share so they agree.
 * 0 for elements without volume (text, image, caption).
 */
export function getEffectiveVolume(element: TimelineElement, timelineMs: number): number {
  if (!('volume' in element)) return 0
  const base = Math.max(0, getAnimatedValue(element, 'volume', timelineMs))
  return base * getFadeGain(element, timelineMs - element.startMs)
}

/** Do fades alter this element's volume anywhere (drives curve sampling)? */
export function hasFades(element: FadeableElement): boolean {
  return (element.fadeInMs ?? 0) > 0 || (element.fadeOutMs ?? 0) > 0
}
