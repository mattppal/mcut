import type { Project } from '@mcut/timeline'
import { type CheckRule, elements, outcome } from './check-kit'

const RANGE_TOLERANCE_MS = 300
const SYNC_TOLERANCE_MS = 250
const SYNC_MIN_SHARE = 0.95

interface Clip {
  startMs: number
  endMs: number
  trimStartMs: number
}

interface SpokenWord {
  text: string
  timeMs: number
}

function clipsOf(project: Project): Clip[] {
  return elements(project).flatMap((element): Clip[] =>
    element.type === 'multicam' || element.type === 'video' || element.type === 'audio'
      ? [{ startMs: element.startMs, endMs: element.startMs + element.durationMs, trimStartMs: element.trimStartMs }]
      : [],
  )
}

function sourceAt(clips: Clip[], timeMs: number): number | undefined {
  const clip = clips.find((candidate) => timeMs >= candidate.startMs && timeMs < candidate.endMs)
  return clip === undefined ? undefined : clip.trimStartMs + (timeMs - clip.startMs)
}

function spokenWords(project: Project): SpokenWord[] {
  return elements(project).flatMap((element): SpokenWord[] =>
    element.type === 'caption' ? (element.words ?? []).map((word) => ({ text: normalize(word.text), timeMs: element.startMs + word.startMs })) : [],
  )
}

const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9']/g, '')

const seconds = (ms: number): string => (ms / 1000).toFixed(1)

export const RETAKE_RULES: CheckRule[] = [
  [
    /^retakes removed$/,
    ({ after, calls }) => {
      const found = calls.find((call) => call.name === 'find_retakes' && !call.isError)
      if (found === undefined) return { pass: false, detail: 'find_retakes was never called successfully' }
      const ranges = [...found.result.matchAll(/"startMs":\s*(\d+),\s*"endMs":\s*(\d+),\s*"abandonedText"/g)].map((match) => ({
        startMs: Number(match[1]),
        endMs: Number(match[2]),
      }))
      if (ranges.length === 0) return { pass: false, detail: 'find_retakes returned no candidates' }
      const clips = clipsOf(after)
      const kept = ranges.filter((range) =>
        clips.some(
          (clip) => Math.min(range.endMs, clip.trimStartMs + (clip.endMs - clip.startMs)) - Math.max(range.startMs, clip.trimStartMs) > RANGE_TOLERANCE_MS,
        ),
      )
      const detail = `${ranges.length - kept.length}/${ranges.length} retake ranges gone${kept.length > 0 ? `, still played ${kept.map((range) => `${seconds(range.startMs)}-${seconds(range.endMs)}s`).join(' ')}` : ''}`
      return outcome(kept.length === 0, detail, detail)
    },
  ],
  [
    /^captions in sync$/,
    ({ before, after }) => {
      const beforeClips = clipsOf(before)
      const truth = spokenWords(before).flatMap((word) => {
        const sourceMs = sourceAt(beforeClips, word.timeMs)
        return sourceMs === undefined ? [] : [{ text: word.text, sourceMs }]
      })
      const afterClips = clipsOf(after)
      const words = spokenWords(after)
      if (truth.length === 0 || words.length === 0) return { pass: false, detail: `${truth.length} captioned words before, ${words.length} after` }
      const orphans = words.filter((word) => sourceAt(afterClips, word.timeMs) === undefined)
      const synced = words.filter((word) => {
        const sourceMs = sourceAt(afterClips, word.timeMs)
        return sourceMs !== undefined && truth.some((spoken) => spoken.text === word.text && Math.abs(spoken.sourceMs - sourceMs) <= SYNC_TOLERANCE_MS)
      })
      const share = synced.length / words.length
      const played = truth.filter((spoken) =>
        afterClips.some((clip) => spoken.sourceMs >= clip.trimStartMs && spoken.sourceMs < clip.trimStartMs + (clip.endMs - clip.startMs)),
      )
      const coverage = played.length === 0 ? 1 : Math.min(1, synced.length / played.length)
      const detail = `${synced.length}/${words.length} caption words land within ${SYNC_TOLERANCE_MS} ms of where they are spoken, ${orphans.length} over no clip, captions cover ${synced.length} of ${played.length} words still played`
      return outcome(share >= SYNC_MIN_SHARE && coverage >= SYNC_MIN_SHARE && orphans.length === 0, detail, detail)
    },
  ],
]
