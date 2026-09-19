import { getAnimatedValue } from './keyframes'
import type { TimelineElement } from './model'

export interface FadeableElement {
  durationMs: number
  fadeInMs?: number | undefined
  fadeOutMs?: number | undefined
}

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

export function getEffectiveVolume(element: TimelineElement, timelineMs: number): number {
  if (!('volume' in element)) return 0
  const base = Math.max(0, getAnimatedValue(element, 'volume', timelineMs))
  return base * getFadeGain(element, timelineMs - element.startMs)
}

export function hasFades(element: FadeableElement): boolean {
  return (element.fadeInMs ?? 0) > 0 || (element.fadeOutMs ?? 0) > 0
}
