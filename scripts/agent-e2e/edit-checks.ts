import { getProjectDurationMs, type Keyframe, type LayoutSlot, type MulticamElement, type Project, type TimelineElement } from '@mcut/timeline'
import type { ToolCall } from './types'

export interface CheckInput {
  before: Project
  after: Project
  calls: ToolCall[]
}

export interface CheckResult {
  check: string
  pass: boolean
  detail: string
}

interface Outcome {
  pass: boolean
  detail: string
}

type Test = (input: CheckInput, match: RegExpExecArray) => Outcome

export class UnknownCheckError extends Error {}

const SUBTLE_ZOOM_MAX = 1.35
const OPENING_WINDOW_MS = 2_000
const HOLD_MIN_MS = 500

const elements = (project: Project): TimelineElement[] => project.tracks.flatMap((track) => track.elements)

const ofType = <T extends TimelineElement['type']>(project: Project, type: T): Extract<TimelineElement, { type: T }>[] =>
  elements(project).filter((element): element is Extract<TimelineElement, { type: T }> => element.type === type)

const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)}s`

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const outcome = (pass: boolean, yes: string, no: string): Outcome => ({ pass, detail: pass ? yes : no })

const scaleKeys = (element: TimelineElement): Keyframe[] => [...(element.keyframes?.['scale.x'] ?? [])].sort((a, b) => a.timeMs - b.timeMs)

const zoomed = (project: Project): TimelineElement[] => elements(project).filter((element) => scaleKeys(element).length >= 2)

const describeKeys = (keys: Keyframe[]): string => keys.map((key) => `${key.timeMs}ms:${key.value.toFixed(2)}`).join(' ')

function isExpo(key: Keyframe): boolean {
  if (key.easing === undefined || typeof key.easing === 'string') return false
  const [x1, y1, x2, y2] = key.easing.cubicBezier
  return (x1 >= 0.6 && y1 <= 0.1) || (x1 <= 0.2 && y1 >= 0.9) || (x2 <= 0.2 && y2 >= 0.9) || (x2 >= 0.7 && y2 <= 0.1)
}

function zoomShape(keys: Keyframe[]): { base: number; peak: number; holdMs: number; returns: boolean; riseAtMs: number } {
  const base = keys[0]?.value ?? 1
  const peak = Math.max(...keys.map((key) => key.value))
  const atPeak = keys.filter((key) => key.value >= peak * 0.98)
  const holdMs = (atPeak.at(-1)?.timeMs ?? 0) - (atPeak[0]?.timeMs ?? 0)
  const last = keys.at(-1)
  const returns = last !== undefined && last.timeMs > (atPeak.at(-1)?.timeMs ?? 0) && Math.abs(last.value - base) / base < 0.02
  const riseAtMs = keys.find((key, index) => (keys[index + 1]?.value ?? key.value) > key.value)?.timeMs ?? Number.POSITIVE_INFINITY
  return { base, peak, holdMs, returns, riseAtMs }
}

function multicamOf(project: Project): MulticamElement | undefined {
  return ofType(project, 'multicam')[0]
}

const isFullFrame = (slot: LayoutSlot): boolean => slot.rect.w >= 0.99 && slot.rect.h >= 0.99

const inBottomRight = (slot: LayoutSlot): boolean => slot.rect.w < 0.5 && slot.rect.x + slot.rect.w / 2 > 0.5 && slot.rect.y + slot.rect.h / 2 > 0.5

function headOverlays(project: Project): LayoutSlot[] {
  const used = new Set(multicamOf(project)?.angles.map((angle) => angle.layoutId) ?? [])
  return project.layouts
    .filter((layout) => used.has(layout.id) && layout.slots.some(isFullFrame))
    .flatMap((layout) => layout.slots)
    .filter(inBottomRight)
}

function sourceAssetName(project: Project, multicam: MulticamElement, key: string | undefined): string {
  const source = multicam.sources.find((entry) => entry.key === key)
  return source === undefined ? `no source "${key}"` : (project.assets[source.assetId]?.name ?? source.assetId)
}

const RULES: [RegExp, Test][] = [
  [
    /^aspect (\d+):(\d+)$/,
    ({ after }, match) => {
      const want = Number(match[1]) / Number(match[2])
      return outcome(Math.abs(after.width / after.height - want) / want < 0.01, `project is ${after.width}x${after.height}`, `project is ${after.width}x${after.height}`)
    },
  ],
  [
    /^duration shorter(?: by (\d+(?:\.\d+)?)s)?$/,
    ({ before, after }, match) => {
      const cut = getProjectDurationMs(before) - getProjectDurationMs(after)
      const detail = `duration ${seconds(getProjectDurationMs(before))} to ${seconds(getProjectDurationMs(after))}`
      return outcome(cut >= (match[1] === undefined ? 1 : Number(match[1]) * 1000 - 100), detail, detail)
    },
  ],
  [
    /^duration shorter by at most (\d+(?:\.\d+)?)s$/,
    ({ before, after }, match) => {
      const cut = getProjectDurationMs(before) - getProjectDurationMs(after)
      const detail = `cut ${seconds(cut)} (duration ${seconds(getProjectDurationMs(before))} to ${seconds(getProjectDurationMs(after))})`
      return outcome(cut <= Number(match[1]) * 1000, detail, detail)
    },
  ],
  [
    /^text "(.+)"$/,
    ({ after }, match) => {
      const texts = [...ofType(after, 'text'), ...ofType(after, 'caption')].map((element) => element.text)
      const want = (match[1] ?? '').toLowerCase()
      return outcome(texts.some((text) => text.toLowerCase().includes(want)), `found in ${JSON.stringify(texts.slice(0, 3))}`, `text elements ${JSON.stringify(texts.slice(0, 5))}`)
    },
  ],
  [
    /^picture fade (in|out)$/,
    ({ after }, match) => {
      const faded = elements(after).filter((element) => {
        const keys = [...(element.keyframes?.opacity ?? [])].sort((a, b) => a.timeMs - b.timeMs)
        const edge = match[1] === 'in' ? keys[0] : keys.at(-1)
        return edge !== undefined && edge.value < 0.05
      })
      const audioOnly = elements(after).filter((element) => Number(Reflect.get(element, match[1] === 'in' ? 'fadeInMs' : 'fadeOutMs') ?? 0) > 0)
      return outcome(faded.length > 0, `opacity keyframes on ${faded.map((element) => element.id).join(', ')}`, audioOnly.length > 0 ? `only an audio fade (fade${match[1] === 'in' ? 'In' : 'Out'}Ms changes gain, not picture)` : 'no opacity fade')
    },
  ],
  [
    /^transcript$/,
    ({ calls }) => {
      const runs = calls.filter((call) => call.name === 'ensure_transcript')
      const ok = runs.find((call) => !call.isError)
      return outcome(ok !== undefined, ok?.result.slice(0, 160) ?? '', runs.length === 0 ? 'ensure_transcript was never called' : `ensure_transcript failed. ${runs.map((call) => call.result.slice(0, 80)).join(' / ')}`)
    },
  ],
  [
    /^captions$/,
    ({ after }) => {
      const count = ofType(after, 'caption').length
      return outcome(count > 0, `${count} caption elements`, 'no caption elements')
    },
  ],
  [
    /^multicam sources (\d+)$/,
    ({ after }, match) => {
      const multicam = multicamOf(after)
      const names = multicam?.sources.map((source) => after.assets[source.assetId]?.name ?? source.assetId) ?? []
      return outcome(names.length >= Number(match[1]), `sources ${names.join(', ')}`, multicam === undefined ? 'no multicam element' : `sources ${names.join(', ')}`)
    },
  ],
  [
    /^multicam audio from audio file$/,
    ({ after }) => {
      const multicam = multicamOf(after)
      if (multicam === undefined) return { pass: false, detail: 'no multicam element' }
      const source = multicam.sources.find((entry) => entry.key === multicam.audioSource)
      const kind = source === undefined ? undefined : after.assets[source.assetId]?.kind
      const name = sourceAssetName(after, multicam, multicam.audioSource)
      return outcome(kind === 'audio', `audio from ${name}`, `audio source is ${multicam.audioSource === undefined ? 'unset' : `${name} (${kind ?? 'unknown kind'})`}`)
    },
  ],
  [
    /^layout head bottom right (\d+):(\d+)$/,
    ({ after }, match) => {
      const want = Number(match[1]) / Number(match[2])
      const fits = after.layouts.filter((layout) =>
        layout.slots.some(isFullFrame) &&
        layout.slots.some((slot) => {
          const aspect = (slot.rect.w * after.width) / (slot.rect.h * after.height)
          return inBottomRight(slot) && aspect >= want * 0.85 && aspect <= want * 1.15
        }),
      )
      const used = new Set(multicamOf(after)?.angles.map((angle) => angle.layoutId) ?? [])
      const active = fits.filter((layout) => used.has(layout.id))
      const slots = after.layouts.map((layout) => `${layout.name}[${layout.slots.map((slot) => `${slot.source}@${slot.rect.x.toFixed(2)},${slot.rect.y.toFixed(2)} ${slot.rect.w.toFixed(2)}x${slot.rect.h.toFixed(2)}`).join('; ')}]`)
      return outcome(active.length > 0, `multicam uses ${active.map((layout) => layout.name).join(', ')}`, fits.length > 0 ? `layout ${fits[0]?.name} fits but no angle uses it` : `no layout fits. ${slots.join(' ')}`)
    },
  ],
  [
    /^head overlay narrower$/,
    ({ before, after }) => {
      const overlayAspect = (project: Project): number | undefined => {
        const aspects = headOverlays(project).map((slot) => (slot.rect.w * project.width) / (slot.rect.h * project.height))
        return aspects.length === 0 ? undefined : Math.min(...aspects)
      }
      const was = overlayAspect(before)
      const now = overlayAspect(after)
      const detail = `overlay aspect ${was?.toFixed(2) ?? 'none'} to ${now?.toFixed(2) ?? 'none'} (9:16 is 0.56)`
      return outcome(was !== undefined && now !== undefined && now < was - 0.02 && now <= 0.75, detail, detail)
    },
  ],
  [
    /^head overlay aspect (\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/,
    ({ after }, match) => {
      const aspects = headOverlays(after).map((slot) => (slot.rect.w * after.width) / (slot.rect.h * after.height))
      const detail = aspects.length === 0 ? 'no overlay slot in a used layout' : `overlay aspect ${aspects.map((aspect) => aspect.toFixed(3)).join(', ')}`
      return outcome(aspects.length > 0 && aspects.every((aspect) => aspect >= Number(match[1]) && aspect <= Number(match[2])), detail, detail)
    },
  ],
  [
    /^head overlay without border$/,
    ({ after }) => {
      const overlays = headOverlays(after)
      const bordered = overlays.filter((slot) => slot.stroke !== undefined && slot.stroke.width > 0)
      const detail = overlays.map((slot) => `${slot.source} stroke ${slot.stroke === undefined ? 'none' : JSON.stringify(slot.stroke)} shadow ${slot.shadow}`).join('; ')
      return outcome(overlays.length > 0 && bordered.length === 0, detail, overlays.length === 0 ? 'no overlay slot in a used layout' : detail)
    },
  ],
  [
    /^zoom at most (\d+(?:\.\d+)?)x$/,
    ({ after }, match) => {
      const peaks = zoomed(after).map((element) => ({ id: element.id, ratio: zoomShape(scaleKeys(element)).peak / zoomShape(scaleKeys(element)).base }))
      const worst = Math.max(0, ...peaks.map((peak) => peak.ratio))
      const detail = peaks.map((peak) => `${peak.id} ${peak.ratio.toFixed(2)}x`).join(', ') || 'no zoom'
      return outcome(peaks.length > 0 && worst <= Number(match[1]), detail, detail)
    },
  ],
  [
    /^angle cuts (\d+)$/,
    ({ after }, match) => {
      const multicam = multicamOf(after)
      const layouts = new Set(multicam?.angles.map((angle) => angle.layoutId) ?? [])
      const cuts = multicam?.angles.length ?? 0
      return outcome(cuts >= Number(match[1]) && layouts.size >= 2, `${cuts} angles across ${layouts.size} layouts`, multicam === undefined ? 'no multicam element' : `${cuts} angles across ${layouts.size} layouts`)
    },
  ],
  [
    /^opening zoom$/,
    ({ after }) => {
      const hits = zoomed(after).filter((element) => {
        const shape = zoomShape(scaleKeys(element))
        return element.startMs + shape.riseAtMs < OPENING_WINDOW_MS && shape.peak > shape.base
      })
      return outcome(hits.length > 0, `zoom on ${hits.map((element) => `${element.id} ${describeKeys(scaleKeys(element))}`).join(', ')}`, 'no scale keyframes rising in the first 2 s')
    },
  ],
  [
    /^zoom in hold out$/,
    ({ after }) => {
      const hits = zoomed(after).filter((element) => {
        const shape = zoomShape(scaleKeys(element))
        return shape.peak > shape.base && shape.holdMs >= HOLD_MIN_MS && shape.returns
      })
      const keyed = zoomed(after).map((element) => `${element.id} ${describeKeys(scaleKeys(element))}`)
      return outcome(hits.length > 0, `in, hold, out on ${hits.map((element) => element.id).join(', ')}`, keyed.length > 0 ? `scale keys without a hold and return. ${keyed.join('; ')}` : 'no scale keyframes')
    },
  ],
  [
    /^subtle zoom$/,
    ({ after }) => {
      const peaks = zoomed(after).map((element) => zoomShape(scaleKeys(element))).map((shape) => shape.peak / shape.base)
      const worst = Math.max(0, ...peaks)
      return outcome(peaks.length > 0 && worst <= SUBTLE_ZOOM_MAX, `largest zoom ${worst.toFixed(2)}x`, peaks.length === 0 ? 'no zoom' : `largest zoom ${worst.toFixed(2)}x`)
    },
  ],
  [
    /^exponential easing$/,
    ({ after }) => {
      const keys = zoomed(after).flatMap(scaleKeys)
      const expo = keys.filter(isExpo)
      return outcome(expo.length > 0, `${expo.length} expo cubic-bezier keys`, keys.length === 0 ? 'no zoom keys' : `easings ${JSON.stringify([...new Set(keys.map((key) => JSON.stringify(key.easing ?? 'linear')))])}`)
    },
  ],
  [
    /^motion blur$/,
    ({ after }) => {
      const targets = zoomed(after)
      const blurred = targets.filter((element) => 'motionBlur' in element && element.motionBlur?.enabled === true)
      return outcome(targets.length > 0 && blurred.length === targets.length, `motion blur on ${blurred.map((element) => element.id).join(', ')}`, targets.length === 0 ? 'no zoomed element' : `${blurred.length} of ${targets.length} zoomed elements have motion blur`)
    },
  ],
  [
    /^probed assets (\d+)$/,
    ({ after }, match) => {
      const assets = Object.values(after.assets)
      const probed = assets.filter((asset) => asset.kind === 'image' || (asset.durationMs ?? 0) > 0)
      const names = assets.map((asset) => `${asset.name ?? asset.id} (${asset.kind}, ${asset.durationMs ?? 'unprobed'} ms, ${asset.src.slice(0, 40)})`)
      return outcome(probed.length >= Number(match[1]), names.join(', '), names.length === 0 ? 'no assets' : names.join(', '))
    },
  ],
  [
    /^more elements$/,
    ({ before, after }) => {
      const detail = `${elements(before).length} to ${elements(after).length} elements`
      return outcome(elements(after).length > elements(before).length, detail, detail)
    },
  ],
  [
    /^action (\S+)$/,
    ({ calls }, match) => {
      const runs = calls.filter((call) => call.name === 'run_action' && call.args.actionId === match[1])
      const ok = runs.find((call) => !call.isError)
      return outcome(ok !== undefined, ok?.result.slice(0, 160) ?? '', runs[0] !== undefined ? `failed. ${runs[0].result.slice(0, 160)}` : `run_action ${match[1]} was never called`)
    },
  ],
  [
    /^no errors$/,
    ({ calls }) => {
      const failed = calls.filter((call) => call.isError)
      return outcome(failed.length === 0, 'every tool call succeeded', `${failed.length} tool calls failed`)
    },
  ],
  [/^changed$/, ({ before, after }) => outcome(!same(before, after), 'project changed', 'project unchanged')],
  [/^unchanged$/, ({ before, after }) => outcome(same(before, after), 'project unchanged', 'project changed')],
]

export const CHECK_VOCABULARY = RULES.map(([pattern]) => pattern.source.replace(/^\^|\$$/g, ''))

const NEGATION = /^not (.+)$/

export function assertKnownCheck(check: string): void {
  const inner = NEGATION.exec(check)?.[1] ?? check
  if (!RULES.some(([pattern]) => pattern.test(inner))) throw new UnknownCheckError(`Unknown check "${check}". Known checks, each also as "not <check>". ${CHECK_VOCABULARY.join(', ')}`)
}

export function runCheck(check: string, input: CheckInput): CheckResult {
  const negated = NEGATION.exec(check)?.[1]
  const inner = negated ?? check
  for (const [pattern, test] of RULES) {
    const match = pattern.exec(inner)
    if (match === null) continue
    const result = test(input, match)
    return { check, pass: negated === undefined ? result.pass : !result.pass, detail: result.detail }
  }
  throw new UnknownCheckError(`Unknown check "${check}".`)
}
