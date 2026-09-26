import type { LayoutSlot, MulticamElement, Project } from '@mcut/timeline'
import { type CheckRule, elements, outcome } from './check-kit'

const OPENING_HOLD_MIN_MS = 8_000
const PAUSE_MIN_MS = 250
const WORD_EDGE_TOLERANCE_MS = 120

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

function openingHeadMs(project: Project): number {
  const first = [...multicams(project)].sort((a, b) => a.startMs - b.startMs)[0]
  if (first === undefined) return 0
  const cuts = [...first.angles].sort((a, b) => a.atMs - b.atMs)
  const opening = cuts.filter((cut) => cut.atMs <= first.trimStartMs).at(-1) ?? cuts[0]
  if (opening === undefined || shotOf(project, first, opening.layoutId) !== 'head') return 0
  const next = cuts.find((cut) => cut.atMs > first.trimStartMs && shotOf(project, first, cut.layoutId) !== 'head')
  return (next?.atMs ?? first.trimStartMs + first.durationMs) - first.trimStartMs
}

function spokenWords(project: Project): { startMs: number; endMs: number }[] {
  return elements(project)
    .flatMap((element) =>
      element.type === 'caption' ? (element.words ?? []).map((word) => ({ startMs: element.startMs + word.startMs, endMs: element.startMs + word.endMs })) : [],
    )
    .sort((a, b) => a.startMs - b.startMs)
}

function pauseAt(project: Project, timeMs: number): number | undefined {
  const words = spokenWords(project)
  const after = words.findIndex((word) => word.startMs >= timeMs - WORD_EDGE_TOLERANCE_MS)
  if (after <= 0) return undefined
  const before = words[after - 1]
  const next = words[after]
  if (before === undefined || next === undefined || before.endMs > timeMs + WORD_EDGE_TOLERANCE_MS) return undefined
  return next.startMs - before.endMs
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
    /^opening punch-in on camera at a pause$/,
    ({ after }) => {
      const first = [...multicams(after)].sort((a, b) => a.startMs - b.startMs)[0]
      if (first === undefined) return { pass: false, detail: 'no multicam' }
      const held = openingHeadMs(after)
      const punches = (first.zooms ?? []).filter((zoom) => zoom.source === 'camera' && zoom.scale > 1 && zoom.atMs < held)
      if (punches.length === 0) return { pass: false, detail: `no camera zoom inside the ${(held / 1000).toFixed(1)}s head-only opening` }
      const described = punches.map((zoom) => {
        const timeMs = first.startMs + zoom.atMs
        const gap = pauseAt(after, timeMs)
        return { zoom, gap, text: `${(timeMs / 1000).toFixed(2)}s ${zoom.scale}x ${gap === undefined ? 'inside a word' : `in a ${gap} ms gap`}` }
      })
      const good = described.filter((entry) => entry.gap !== undefined && entry.gap >= PAUSE_MIN_MS)
      const detail = described.map((entry) => entry.text).join('; ')
      return outcome(good.length > 0, detail, detail)
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
]
