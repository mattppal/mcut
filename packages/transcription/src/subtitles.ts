import { groupWords, type WordGroup } from './captions'
import type { TranscriptResult } from './types'

export interface SubtitleCue {
  startMs: number
  endMs: number
  text: string
}

/**
 * Turn a transcript into display cues: prefers provider segments, falls back
 * to grouped words, then to one cue spanning the full duration.
 */
export function transcriptToCues(result: TranscriptResult): SubtitleCue[] {
  if (result.segments.length > 0) {
    return result.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text }))
  }
  if (result.words.length > 0) {
    return groupWords(result.words).map((group: WordGroup) => ({
      startMs: group.startMs,
      endMs: group.endMs,
      text: group.text,
    }))
  }
  if (result.text.trim().length > 0 && result.durationMs) {
    return [{ startMs: 0, endMs: result.durationMs, text: result.text.trim() }]
  }
  return []
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

function formatTimestamp(ms: number, separator: ',' | '.'): string {
  const clamped = Math.max(0, Math.round(ms))
  const hours = Math.floor(clamped / 3_600_000)
  const minutes = Math.floor((clamped % 3_600_000) / 60_000)
  const seconds = Math.floor((clamped % 60_000) / 1000)
  const millis = clamped % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(millis, 3)}`
}

export function toSrt(input: TranscriptResult | SubtitleCue[]): string {
  const cues = Array.isArray(input) ? input : transcriptToCues(input)
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatTimestamp(cue.startMs, ',')} --> ${formatTimestamp(cue.endMs, ',')}\n${cue.text}`,
    )
    .join('\n\n')
    .concat(cues.length > 0 ? '\n' : '')
}

export function toVtt(input: TranscriptResult | SubtitleCue[]): string {
  const cues = Array.isArray(input) ? input : transcriptToCues(input)
  const body = cues
    .map(
      (cue) =>
        `${formatTimestamp(cue.startMs, '.')} --> ${formatTimestamp(cue.endMs, '.')}\n${cue.text}`,
    )
    .join('\n\n')
  return `WEBVTT\n\n${body}${cues.length > 0 ? '\n' : ''}`
}
