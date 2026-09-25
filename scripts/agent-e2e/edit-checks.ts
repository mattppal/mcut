import { getProjectDurationMs, type LayoutSlot, type Project } from '@mcut/timeline'
import { type OverlaySample, REFERENCE_LOOK, rectOffReference, sampleOverlay } from './export-frames'
import { type CheckInput, type CheckResult, type CheckRule, elements, multicamOf, ofType, outcome, same, seconds, sourceAssetName } from './check-kit'
import { ZOOM_RULES } from './zoom-checks'

export class UnknownCheckError extends Error {}

const STYLED_RADIUS = { min: 0.04, max: 0.12 }

const isFullFrame = (slot: LayoutSlot): boolean => slot.rect.w >= 0.99 && slot.rect.h >= 0.99

const inBottomRight = (slot: LayoutSlot): boolean => slot.rect.w < 0.5 && slot.rect.x + slot.rect.w / 2 > 0.5 && slot.rect.y + slot.rect.h / 2 > 0.5

function headOverlays(project: Project): LayoutSlot[] {
  const used = new Set(multicamOf(project)?.angles.map((angle) => angle.layoutId) ?? [])
  return project.layouts
    .filter((layout) => used.has(layout.id) && layout.slots.some(isFullFrame))
    .flatMap((layout) => layout.slots)
    .filter(inBottomRight)
}

const RULES: CheckRule[] = [
  [
    /^aspect (\d+):(\d+)$/,
    ({ after }, match) => {
      const want = Number(match[1]) / Number(match[2])
      return outcome(
        Math.abs(after.width / after.height - want) / want < 0.01,
        `project is ${after.width}x${after.height}`,
        `project is ${after.width}x${after.height}`,
      )
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
      return outcome(
        texts.some((text) => text.toLowerCase().includes(want)),
        `found in ${JSON.stringify(texts.slice(0, 3))}`,
        `text elements ${JSON.stringify(texts.slice(0, 5))}`,
      )
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
      return outcome(
        faded.length > 0,
        `opacity keyframes on ${faded.map((element) => element.id).join(', ')}`,
        audioOnly.length > 0 ? `only an audio fade (fade${match[1] === 'in' ? 'In' : 'Out'}Ms changes gain, not picture)` : 'no opacity fade',
      )
    },
  ],
  [
    /^transcript$/,
    ({ calls }) => {
      const runs = calls.filter((call) => call.name === 'ensure_transcript')
      const ok = runs.find((call) => !call.isError)
      return outcome(
        ok !== undefined,
        ok?.result.slice(0, 160) ?? '',
        runs.length === 0 ? 'ensure_transcript was never called' : `ensure_transcript failed. ${runs.map((call) => call.result.slice(0, 80)).join(' / ')}`,
      )
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
      return outcome(
        names.length >= Number(match[1]),
        `sources ${names.join(', ')}`,
        multicam === undefined ? 'no multicam element' : `sources ${names.join(', ')}`,
      )
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
      return outcome(
        kind === 'audio',
        `audio from ${name}`,
        `audio source is ${multicam.audioSource === undefined ? 'unset' : `${name} (${kind ?? 'unknown kind'})`}`,
      )
    },
  ],
  [
    /^layout head bottom right (\d+):(\d+)$/,
    ({ after }, match) => {
      const want = Number(match[1]) / Number(match[2])
      const fits = after.layouts.filter(
        (layout) =>
          layout.slots.some(isFullFrame) &&
          layout.slots.some((slot) => {
            const aspect = (slot.rect.w * after.width) / (slot.rect.h * after.height)
            return inBottomRight(slot) && aspect >= want * 0.85 && aspect <= want * 1.15
          }),
      )
      const used = new Set(multicamOf(after)?.angles.map((angle) => angle.layoutId) ?? [])
      const active = fits.filter((layout) => used.has(layout.id))
      const slots = after.layouts.map(
        (layout) =>
          `${layout.name}[${layout.slots.map((slot) => `${slot.source}@${slot.rect.x.toFixed(2)},${slot.rect.y.toFixed(2)} ${slot.rect.w.toFixed(2)}x${slot.rect.h.toFixed(2)}`).join('; ')}]`,
      )
      return outcome(
        active.length > 0,
        `multicam uses ${active.map((layout) => layout.name).join(', ')}`,
        fits.length > 0 ? `layout ${fits[0]?.name} fits but no angle uses it` : `no layout fits. ${slots.join(' ')}`,
      )
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
    /^head overlay styled$/,
    ({ after }) => {
      const overlays = headOverlays(after)
      const styled = overlays.filter(
        (slot) =>
          slot.cornerRadius >= STYLED_RADIUS.min &&
          slot.cornerRadius <= STYLED_RADIUS.max &&
          slot.shadow &&
          (slot.stroke === undefined || slot.stroke.width === 0),
      )
      const detail =
        overlays
          .map(
            (slot) => `${slot.source} cornerRadius ${slot.cornerRadius} shadow ${slot.shadow} stroke ${slot.stroke === undefined ? 'none' : slot.stroke.width}`,
          )
          .join('; ') || 'no overlay slot in a used layout'
      return outcome(overlays.length > 0 && styled.length === overlays.length, detail, detail)
    },
  ],
  [
    /^exported overlay styled$/,
    ({ after, calls }) => {
      const done = calls.find((call) => call.name === 'get_export' && !call.isError && /"state":\s*"done"/.test(call.result))
      const path = done === undefined ? undefined : /"outputPath":\s*"([^"]+)"/.exec(done.result)?.[1]
      const multicam = multicamOf(after)
      if (path === undefined || multicam === undefined)
        return { pass: false, detail: path === undefined ? 'no finished export to sample' : 'no multicam element' }
      const spans = multicam.angles
        .map((angle, index) => ({ angle, endMs: multicam.angles[index + 1]?.atMs ?? multicam.durationMs }))
        .map(({ angle, endMs }) => ({
          midMs: multicam.startMs + (angle.atMs + endMs) / 2,
          slot: after.layouts.find((layout) => layout.id === angle.layoutId && layout.slots.some(isFullFrame))?.slots.find(inBottomRight),
        }))
        .filter((span): span is { midMs: number; slot: LayoutSlot } => span.slot !== undefined)
        .slice(0, 3)
      if (spans.length === 0) return { pass: false, detail: 'no screen plus head span to sample' }
      let samples: OverlaySample[]
      try {
        samples = spans.map((span) => sampleOverlay(path, span.midMs, span.slot, after.width, after.height))
      } catch (error) {
        return { pass: false, detail: error instanceof Error ? error.message : String(error) }
      }
      const rounded = samples.filter((sample) => sample.rounded).length
      const shadowed = samples.filter((sample) => sample.shadowDelta >= REFERENCE_LOOK.shadowDelta / 2).length
      const off = Math.max(...spans.map((span) => rectOffReference(span.slot)))
      const detail = `rounded ${rounded}/${samples.length}, shadow ${shadowed}/${samples.length} (reference ${REFERENCE_LOOK.shadowDelta}), slot off reference by ${off.toFixed(3)}. ${samples.map((sample) => `${(sample.timeMs / 1000).toFixed(1)}s corner ${sample.cornerContrast.toFixed(0)} shadow ${sample.shadowDelta.toFixed(0)}`).join(', ')}`
      return outcome(rounded * 2 > samples.length && shadowed * 2 > samples.length && off <= REFERENCE_LOOK.rectTolerance, detail, detail)
    },
  ],
  [
    /^head overlay without border$/,
    ({ after }) => {
      const overlays = headOverlays(after)
      const bordered = overlays.filter((slot) => slot.stroke !== undefined && slot.stroke.width > 0)
      const detail = overlays
        .map((slot) => `${slot.source} stroke ${slot.stroke === undefined ? 'none' : JSON.stringify(slot.stroke)} shadow ${slot.shadow}`)
        .join('; ')
      return outcome(overlays.length > 0 && bordered.length === 0, detail, overlays.length === 0 ? 'no overlay slot in a used layout' : detail)
    },
  ],
  [
    /^head overlay follows the person$/,
    ({ after }) => {
      const keys = new Set(headOverlays(after).map((slot) => slot.source))
      const tracked = (multicamOf(after)?.sources ?? []).filter((source) => keys.has(source.key))
      const detail = tracked.map((source) => `${source.key} reframe ${source.reframe ? `${source.reframe.length} keys` : 'none'}`).join('; ') || 'no overlay slot in a used layout'
      return outcome(tracked.some((source) => (source.reframe?.length ?? 0) >= 2), detail, detail)
    },
  ],
  [
    /^angle cuts (\d+)$/,
    ({ after }, match) => {
      const multicam = multicamOf(after)
      const layouts = new Set(multicam?.angles.map((angle) => angle.layoutId) ?? [])
      const cuts = multicam?.angles.length ?? 0
      return outcome(
        cuts >= Number(match[1]) && layouts.size >= 2,
        `${cuts} angles across ${layouts.size} layouts`,
        multicam === undefined ? 'no multicam element' : `${cuts} angles across ${layouts.size} layouts`,
      )
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
    /^export job done$/,
    ({ calls }) => {
      const started = calls.filter((call) => call.name === 'export_video' && !call.isError)
      const done = calls.find((call) => call.name === 'get_export' && !call.isError && /"state":\s*"done"/.test(call.result))
      const detail =
        done?.result.slice(0, 200) ??
        (started.length === 0 ? 'export_video was never called successfully' : `started ${started.length} job(s), no get_export answered done`)
      return outcome(started.length > 0 && done !== undefined, detail, detail)
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
  ...ZOOM_RULES,
]

export const CHECK_VOCABULARY = RULES.map(([pattern]) => pattern.source.replace(/^\^|\$$/g, ''))

const NEGATION = /^not (.+)$/

export function assertKnownCheck(check: string): void {
  const inner = NEGATION.exec(check)?.[1] ?? check
  if (!RULES.some(([pattern]) => pattern.test(inner)))
    throw new UnknownCheckError(`Unknown check "${check}". Known checks, each also as "not <check>". ${CHECK_VOCABULARY.join(', ')}`)
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
