import type { Keyframe, Project, TimelineElement } from '@mcut/timeline'
import { type CheckRule, elements, multicamOf, outcome } from './check-kit'

const SUBTLE_ZOOM_MAX = 1.35
const OPENING_WINDOW_MS = 2_000
const HOLD_MIN_MS = 500

const EXPO_EASINGS = new Set(['easeInExpo', 'easeOutExpo', 'easeInOutExpo'])

interface Zoom {
  label: string
  source: string | undefined
  startMs: number
  ratio: number
  holdMs: number
  returns: boolean
  expo: boolean
  blur: boolean
}

const scaleKeys = (element: TimelineElement): Keyframe[] => [...(element.keyframes?.['scale.x'] ?? [])].sort((a, b) => a.timeMs - b.timeMs)

function isExpo(key: Keyframe): boolean {
  if (key.easing === undefined) return false
  if (typeof key.easing === 'string') return EXPO_EASINGS.has(key.easing)
  const [x1, y1, x2, y2] = key.easing.cubicBezier
  return (x1 >= 0.6 && y1 <= 0.1) || (x1 <= 0.2 && y1 >= 0.9) || (x2 <= 0.2 && y2 >= 0.9) || (x2 >= 0.7 && y2 <= 0.1)
}

function keyframeZoom(element: TimelineElement, keys: Keyframe[]): Zoom {
  const base = keys[0]?.value ?? 1
  const peak = Math.max(...keys.map((key) => key.value))
  const atPeak = keys.filter((key) => key.value >= peak * 0.98)
  const last = keys.at(-1)
  const riseAtMs = keys.find((key, index) => (keys[index + 1]?.value ?? key.value) > key.value)?.timeMs ?? Number.POSITIVE_INFINITY
  return {
    label: `${element.id} keyframes ${keys.map((key) => `${key.timeMs}ms:${key.value.toFixed(2)}`).join(' ')}`,
    source: undefined,
    startMs: element.startMs + riseAtMs,
    ratio: peak / base,
    holdMs: (atPeak.at(-1)?.timeMs ?? 0) - (atPeak[0]?.timeMs ?? 0),
    returns: last !== undefined && last.timeMs > (atPeak.at(-1)?.timeMs ?? 0) && Math.abs(last.value - base) / base < 0.02,
    expo: keys.some(isExpo),
    blur: 'motionBlur' in element && element.motionBlur?.enabled === true,
  }
}

function zooms(project: Project): Zoom[] {
  return elements(project).flatMap((element): Zoom[] => {
    const keys = scaleKeys(element)
    const fromKeys = keys.length >= 2 && keys.some((key) => key.value !== keys[0]?.value) ? [keyframeZoom(element, keys)] : []
    const regions = 'zooms' in element ? (element.zooms ?? []) : []
    const fromRegions = regions.map((region): Zoom => ({
      label: `${element.id}${region.source === undefined ? '' : `/${region.source}`} region ${region.id} at ${region.atMs}ms ${region.scale}x`,
      source: region.source,
      startMs: element.startMs + region.atMs,
      ratio: region.scale,
      holdMs: region.holdMs,
      returns: region.outMs > 0,
      expo: typeof region.easing === 'string' ? EXPO_EASINGS.has(region.easing) : isExpo({ timeMs: 0, value: 1, easing: region.easing }),
      blur: region.motionBlur > 0,
    }))
    return [...fromKeys, ...fromRegions]
  })
}

const labels = (list: Zoom[]): string => list.map((zoom) => zoom.label).join('; ')

function addedZooms(before: Project, after: Project): Zoom[] {
  const existing = new Set(zooms(before).map((zoom) => zoom.label))
  return zooms(after).filter((zoom) => !existing.has(zoom.label))
}

export const ZOOM_RULES: CheckRule[] = [
  [
    /^zoom at most (\d+(?:\.\d+)?)x$/,
    ({ after }, match) => {
      const found = zooms(after)
      const detail = found.map((zoom) => `${zoom.label} (${zoom.ratio.toFixed(2)}x)`).join('; ') || 'no zoom'
      return outcome(found.length > 0 && found.every((zoom) => zoom.ratio <= Number(match[1])), detail, detail)
    },
  ],
  [
    /^opening zoom$/,
    ({ after }) => {
      const hits = zooms(after).filter((zoom) => zoom.startMs < OPENING_WINDOW_MS && zoom.ratio > 1)
      return outcome(hits.length > 0, `zoom ${labels(hits)}`, 'no zoom starting in the first 2 s')
    },
  ],
  [
    /^zoom in hold out$/,
    ({ before, after }) => {
      const found = addedZooms(before, after)
      const hits = found.filter((zoom) => zoom.ratio > 1 && zoom.holdMs >= HOLD_MIN_MS && zoom.returns)
      return outcome(
        hits.length > 0,
        `in, hold, out on ${labels(hits)}`,
        found.length > 0 ? `no new zoom holds and returns. ${labels(found)}` : 'no new zoom in this step',
      )
    },
  ],
  [
    /^subtle zoom$/,
    ({ after }) => {
      const found = zooms(after)
      const worst = Math.max(0, ...found.map((zoom) => zoom.ratio))
      return outcome(
        found.length > 0 && worst <= SUBTLE_ZOOM_MAX,
        `largest zoom ${worst.toFixed(2)}x`,
        found.length === 0 ? 'no zoom' : `largest zoom ${worst.toFixed(2)}x`,
      )
    },
  ],
  [
    /^exponential easing$/,
    ({ after }) => {
      const found = zooms(after)
      const expo = found.filter((zoom) => zoom.expo)
      return outcome(
        found.length > 0 && expo.length === found.length,
        `${expo.length} of ${found.length} zooms use expo easing`,
        found.length === 0 ? 'no zoom' : `${expo.length} of ${found.length} zooms use expo easing`,
      )
    },
  ],
  [
    /^motion blur$/,
    ({ after }) => {
      const found = zooms(after)
      const blurred = found.filter((zoom) => zoom.blur)
      return outcome(
        found.length > 0 && blurred.length === found.length,
        `motion blur on ${blurred.length} of ${found.length} zooms`,
        found.length === 0 ? 'no zoom' : `motion blur on ${blurred.length} of ${found.length} zooms`,
      )
    },
  ],
  [
    /^zoom on screen source$/,
    ({ before, after }) => {
      const multicam = multicamOf(after)
      const screenKeys = new Set(
        multicam?.sources.filter((source) => /screen|tscc/i.test(`${source.key} ${after.assets[source.assetId]?.name ?? ''}`)).map((source) => source.key) ??
          [],
      )
      const found = addedZooms(before, after).filter((zoom) => zoom.ratio > 1)
      const onScreen = found.filter((zoom) => zoom.source !== undefined && screenKeys.has(zoom.source))
      return outcome(
        found.length > 0 && onScreen.length === found.length,
        `every zoom targets the screen source. ${labels(onScreen)}`,
        found.length === 0 ? 'no new zoom in this step' : `${found.length - onScreen.length} zoom(s) scale the whole composite or the camera. ${labels(found)}`,
      )
    },
  ],
]
