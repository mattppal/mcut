import type { LayoutSlot, MulticamElement, Project } from '@mcut/timeline'
import { type CheckRule, elements, outcome } from './check-kit'

const OPENING_HOLD_MIN_MS = 8_000
const MIN_SHOT_MS = 2_000
const COVERAGE_MIN = 0.8
const BOUNDARY_BEFORE_MS = 150
const BOUNDARY_AFTER_MS = 400

type Shot = 'head' | 'screen' | 'other'

const multicams = (project: Project): MulticamElement[] => elements(project).flatMap((element) => (element.type === 'multicam' ? [element] : []))

const isScreenKey = (project: Project, multicam: MulticamElement, key: string): boolean =>
  /screen|tscc/i.test(`${key} ${project.assets[multicam.sources.find((source) => source.key === key)?.assetId ?? '']?.name ?? ''}`)

const fullFrame = (slot: LayoutSlot): boolean => slot.rect.w >= 0.99 && slot.rect.h >= 0.99

function shotOf(project: Project, multicam: MulticamElement, layoutId: string): Shot {
  const slots = project.layouts.find((layout) => layout.id === layoutId)?.slots ?? []
  const base = slots.find(fullFrame)
  if (base === undefined) return 'other'
  if (isScreenKey(project, multicam, base.source)) return 'screen'
  return slots.every((slot) => !isScreenKey(project, multicam, slot.source)) ? 'head' : 'other'
}

function shotAtSource(project: Project, sourceMs: number): Shot | undefined {
  const piece = multicams(project).find((element) => sourceMs >= element.trimStartMs && sourceMs < element.trimStartMs + element.durationMs)
  if (piece === undefined) return undefined
  const angle = [...piece.angles]
    .sort((a, b) => a.atMs - b.atMs)
    .filter((cut) => cut.atMs <= sourceMs)
    .at(-1)
  return angle === undefined ? undefined : shotOf(project, piece, angle.layoutId)
}

const ordered = (project: Project): MulticamElement[] => [...multicams(project)].sort((a, b) => a.startMs - b.startMs)

function openingHeadMs(project: Project): number {
  for (const piece of ordered(project)) {
    const end = piece.trimStartMs + piece.durationMs
    const cuts = [...piece.angles].sort((a, b) => a.atMs - b.atMs)
    const starts = [piece.trimStartMs, ...cuts.map((cut) => cut.atMs).filter((atMs) => atMs > piece.trimStartMs && atMs < end)]
    for (const clockMs of starts) {
      const cut = cuts.filter((candidate) => candidate.atMs <= clockMs).at(-1)
      if (cut === undefined || shotOf(project, piece, cut.layoutId) !== 'head') return piece.startMs + (clockMs - piece.trimStartMs)
    }
  }
  const last = ordered(project).at(-1)
  return last === undefined ? 0 : last.startMs + last.durationMs
}

export interface ScreenSpan {
  layoutId: string
  sourceStartMs: number
  sourceEndMs: number
  timelineStartMs: number
  timelineEndMs: number
}

export function screenSpans(project: Project): ScreenSpan[] {
  return ordered(project).flatMap((piece) => {
    const end = piece.trimStartMs + piece.durationMs
    const cuts = [...piece.angles].sort((a, b) => a.atMs - b.atMs)
    const bounds = [piece.trimStartMs, ...cuts.map((cut) => cut.atMs).filter((atMs) => atMs > piece.trimStartMs && atMs < end), end]
    return bounds.slice(0, -1).flatMap((startMs, index): ScreenSpan[] => {
      const cut = cuts.filter((candidate) => candidate.atMs <= startMs).at(-1)
      const endMs = bounds[index + 1] ?? end
      if (cut === undefined || shotOf(project, piece, cut.layoutId) !== 'screen') return []
      return [
        {
          layoutId: cut.layoutId,
          sourceStartMs: startMs,
          sourceEndMs: endMs,
          timelineStartMs: piece.startMs + (startMs - piece.trimStartMs),
          timelineEndMs: piece.startMs + (endMs - piece.trimStartMs),
        },
      ]
    })
  })
}

const overlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): number =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs))

const windows = (text: string): { startMs: number; endMs: number }[] =>
  [...text.matchAll(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s/g)].map((match) => ({ startMs: Number(match[1]) * 1000, endMs: Number(match[2]) * 1000 }))

function spokenWords(project: Project): { text: string; startMs: number; endMs: number }[] {
  return elements(project)
    .flatMap((element) =>
      element.type === 'caption'
        ? (element.words ?? []).map((word) => ({ text: word.text, startMs: element.startMs + word.startMs, endMs: element.startMs + word.endMs }))
        : [],
    )
    .sort((a, b) => a.startMs - b.startMs)
}

function clauseEndAt(project: Project, timeMs: number): string | undefined {
  const word = spokenWords(project)
    .filter((candidate) => candidate.endMs >= timeMs - BOUNDARY_AFTER_MS && candidate.endMs <= timeMs + BOUNDARY_BEFORE_MS)
    .at(-1)
  return word !== undefined && /[.,!?;]$/.test(word.text) ? word.text : undefined
}

const seconds = (text: string): number[] => [...text.matchAll(/(\d+(?:\.\d+)?)s/g)].map((match) => Number(match[1]) * 1000)

export const SHOT_RULES: CheckRule[] = [
  [
    /^opens on head only$/,
    ({ after }) => {
      const held = openingHeadMs(after)
      const detail = held === 0 ? 'the first shot is not the head-only layout' : `head-only opening holds ${(held / 1000).toFixed(1)}s`
      return outcome(held >= OPENING_HOLD_MIN_MS, detail, detail)
    },
  ],
  [
    /^opening punch-in on camera at a clause end$/,
    ({ after }) => {
      const held = openingHeadMs(after)
      const punches = ordered(after).flatMap((piece) =>
        (piece.zooms ?? [])
          .filter((zoom) => zoom.source === 'camera' && zoom.scale > 1)
          .map((zoom) => ({ zoom, timeMs: piece.startMs + zoom.atMs }))
          .filter((entry) => entry.timeMs < held),
      )
      if (punches.length === 0) return { pass: false, detail: `no camera zoom inside the ${(held / 1000).toFixed(1)}s head-only opening` }
      const described = punches.map(({ zoom, timeMs }) => {
        const word = clauseEndAt(after, timeMs)
        return { word, text: `${(timeMs / 1000).toFixed(2)}s ${zoom.scale}x ${word === undefined ? 'not at a clause end' : `after "${word}"`}` }
      })
      const detail = described.map((entry) => entry.text).join('; ')
      return outcome(
        described.some((entry) => entry.word !== undefined),
        detail,
        detail,
      )
    },
  ],
  [
    /^(head|screen) shot at ((?:\d+(?:\.\d+)?s ?)+)$/,
    ({ after }, match) => {
      const want = match[1] === 'head' ? 'head' : 'screen'
      const times = seconds(match[2] ?? '')
      const found = times.map((timeMs) => ({ timeMs, shot: shotAtSource(after, timeMs) }))
      const wrong = found.filter((entry) => entry.shot !== want)
      const detail = found.map((entry) => `${(entry.timeMs / 1000).toFixed(0)}s ${entry.shot ?? 'not played'}`).join(', ')
      return outcome(wrong.length === 0, detail, detail)
    },
  ],
  [
    /^screen shown during ((?:\d+(?:\.\d+)?-\d+(?:\.\d+)?s ?)+)$/,
    ({ after }, match) => {
      const shown = screenSpans(after).map((span) => ({ startMs: span.sourceStartMs, endMs: span.sourceEndMs }))
      const found = windows(match[1] ?? '').map((window) => ({ window, ms: shown.reduce((sum, span) => sum + overlap(span, window), 0) }))
      const detail = found.map(({ window, ms }) => `${window.startMs / 1000}-${window.endMs / 1000}s screen ${(ms / 1000).toFixed(1)}s`).join(', ')
      return outcome(
        found.every(({ ms }) => ms >= MIN_SHOT_MS),
        detail,
        detail,
      )
    },
  ],
  [
    /^zoom covers shown ((?:\d+(?:\.\d+)?-\d+(?:\.\d+)?s ?)+)$/,
    ({ after }, match) => {
      const shown = screenSpans(after).map((span) => ({ startMs: span.sourceStartMs, endMs: span.sourceEndMs }))
      const zooms = ordered(after).flatMap((piece) =>
        (piece.zooms ?? [])
          .filter((zoom) => zoom.scale > 1 && zoom.source !== undefined && isScreenKey(after, piece, zoom.source))
          .map((zoom) => ({ startMs: piece.trimStartMs + zoom.atMs, endMs: piece.trimStartMs + zoom.atMs + zoom.inMs + zoom.holdMs + zoom.outMs })),
      )
      const spans = windows(match[1] ?? '')
      const results = spans.map((span) => {
        const visible = shown.reduce((sum, part) => sum + overlap(part, span), 0)
        const zoomed = zooms.reduce((sum, zoom) => sum + overlap(zoom, span), 0)
        return { span, visible, zoomed }
      })
      const due = results.filter((result) => result.visible >= MIN_SHOT_MS)
      const missed = due.filter((result) => result.zoomed < result.visible * COVERAGE_MIN)
      const stray = zooms.filter((zoom) => !spans.some((span) => overlap(zoom, span) > 0))
      const label = (range: { startMs: number; endMs: number }): string => `${(range.startMs / 1000).toFixed(1)}-${(range.endMs / 1000).toFixed(1)}s`
      const detail = [
        results.map((result) => `${label(result.span)} shown ${(result.visible / 1000).toFixed(1)}s zoomed ${(result.zoomed / 1000).toFixed(1)}s`).join(', '),
        stray.length > 0 ? `off-span zooms ${stray.map(label).join(' ')}` : '',
      ]
        .filter((part) => part.length > 0)
        .join('. ')
      return outcome(due.length > 0 && missed.length === 0 && stray.length === 0, detail, detail)
    },
  ],
]
