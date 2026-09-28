import type { MulticamElement, Project } from '@mcut/timeline'
import { type CheckRule, elements, outcome } from './check-kit'
import { meanLuma } from './export-frames'
import { shotAtSource } from './shot-checks'
import type { ToolCall } from './types'

const MIN_FIRST_SHOT_MS = 2_000
const MAX_LEAD_MS = 1_500
const FADE_END_MS = { min: 200, max: 2_000 }
const BLACK_LUMA = 20
const LIT_LUMA = 40
const LIT_AT_MS = 2_000
const CUT_TOLERANCE_MS = 500
const PROBE_MS = 50

const pieces = (project: Project): MulticamElement[] =>
  elements(project)
    .flatMap((element) => (element.type === 'multicam' ? [element] : []))
    .sort((a, b) => a.startMs - b.startMs)

const firstWordMs = (project: Project): number | undefined =>
  elements(project)
    .flatMap((element) => (element.type === 'caption' ? (element.words ?? []).map((word) => element.startMs + word.startMs) : []))
    .sort((a, b) => a - b)[0]

const seconds = (text: string): number[] => [...text.matchAll(/(\d+(?:\.\d+)?)s/g)].map((match) => Number(match[1]) * 1000)

export function exportedPath(calls: ToolCall[]): string | undefined {
  const done = calls.find((call) => call.name === 'get_export' && !call.isError && /"state":\s*"done"/.test(call.result))
  return done === undefined ? undefined : /"outputPath":\s*"([^"]+)"/.exec(done.result)?.[1]
}

export const OPENING_RULES: CheckRule[] = [
  [
    /^clean opening$/,
    ({ after }) => {
      const first = pieces(after)[0]
      const wordMs = firstWordMs(after)
      if (first === undefined || first.startMs > 0) return { pass: false, detail: 'nothing plays at 0s' }
      if (wordMs === undefined) return { pass: false, detail: 'no captioned words to find the first line' }
      const endMs = first.startMs + first.durationMs
      const detail = `first word at ${(wordMs / 1000).toFixed(2)}s, first shot 0-${(endMs / 1000).toFixed(2)}s`
      return outcome(wordMs < endMs && endMs >= MIN_FIRST_SHOT_MS && wordMs <= MAX_LEAD_MS, detail, detail)
    },
  ],
  [
    /^fades in from black$/,
    ({ after }) => {
      const first = pieces(after)[0]
      const opacity = first?.startMs === 0 ? [...(first.keyframes?.opacity ?? [])].sort((a, b) => a.timeMs - b.timeMs) : []
      const start = opacity[0]
      const lit = opacity.find((keyframe) => keyframe.value >= 0.95)
      if (start === undefined || lit === undefined) return { pass: false, detail: 'the first clip has no opacity fade' }
      const detail = `opacity ${start.value} at ${start.timeMs} ms to ${lit.value} at ${lit.timeMs} ms`
      return outcome(start.timeMs === 0 && start.value <= 0.05 && lit.timeMs >= FADE_END_MS.min && lit.timeMs <= FADE_END_MS.max, detail, detail)
    },
  ],
  [
    /^exported fades in from black$/,
    ({ after, calls }) => {
      const path = exportedPath(calls)
      if (path === undefined) return { pass: false, detail: 'no finished export to sample' }
      let black: number
      let lit: number
      try {
        black = meanLuma(path, 0, after.width, after.height)
        lit = meanLuma(path, LIT_AT_MS, after.width, after.height)
      } catch (error) {
        return { pass: false, detail: error instanceof Error ? error.message : String(error) }
      }
      const detail = `mean luma ${black.toFixed(0)} at 0s, ${lit.toFixed(0)} at ${LIT_AT_MS / 1000}s`
      return outcome(black <= BLACK_LUMA && lit >= LIT_LUMA, detail, detail)
    },
  ],
  [
    /^retake cut at ((?:\d+(?:\.\d+)?s ?)+) cuts to the screen$/,
    ({ after }, match) => {
      const cuts = pieces(after).slice(1)
      const found = seconds(match[1] ?? '').map((sourceMs) => {
        const piece = cuts.find((candidate) => Math.abs(candidate.trimStartMs - sourceMs) <= CUT_TOLERANCE_MS)
        return { sourceMs, piece, shot: piece === undefined ? undefined : shotAtSource(after, piece.trimStartMs + PROBE_MS) }
      })
      const detail = found
        .map(({ sourceMs, piece, shot }) =>
          piece === undefined
            ? `${(sourceMs / 1000).toFixed(1)}s no cut`
            : `${(sourceMs / 1000).toFixed(1)}s at ${(piece.startMs / 1000).toFixed(1)}s ${shot ?? 'not played'}`,
        )
        .join(', ')
      return outcome(
        found.every((entry) => entry.shot === 'screen'),
        detail,
        detail,
      )
    },
  ],
]
