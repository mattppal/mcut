import type { TranscriptSegment, TranscriptWord } from '@mcut/transcription'

export interface AudioChunk {
  startS: number
  endS: number
}

// Whisper models are trained on 30-second audio chunks. https://github.com/openai/whisper/blob/main/whisper/audio.py
export const CHUNK_WINDOW_S = 30
export const CHUNK_OVERLAP_S = 5
export const MIN_OVERLAP_PAUSE_MS = 120

export function planChunks(durationS: number, windowS = CHUNK_WINDOW_S, overlapS = CHUNK_OVERLAP_S): AudioChunk[] {
  if (durationS <= 0) return []
  if (durationS <= windowS) return [{ startS: 0, endS: durationS }]
  const step = windowS - overlapS
  const chunks: AudioChunk[] = []
  for (let start = 0; start < durationS - overlapS; start += step) {
    chunks.push({ startS: start, endS: Math.min(durationS, start + windowS) })
  }
  return chunks
}

export interface ChunkResult {
  chunk: AudioChunk
  words: TranscriptWord[]
}

export interface ChunkSegmentResult {
  chunk: AudioChunk
  segments: TranscriptSegment[]
}

export function mergeChunkWords(results: ChunkResult[]): TranscriptWord[] {
  const present = results.filter((r) => r.words.length > 0)
  if (present.length === 0) return []
  let merged: TranscriptWord[] = [...present[0]!.words]
  for (let i = 1; i < present.length; i++) {
    const next = present[i]!
    const overlapStartMs = next.chunk.startS * 1000
    const prevEndMs = present[i - 1]!.chunk.endS * 1000
    const overlapEndMs = Math.min(prevEndMs, next.chunk.endS * 1000)
    if (overlapEndMs <= overlapStartMs) {
      merged = [...merged, ...next.words]
      continue
    }
    const cutMs = cutAtLargestPauseOrOverlapMidpoint(next.words, overlapStartMs, overlapEndMs)
    merged = [...merged.filter((w) => w.startMs < cutMs), ...next.words.filter((w) => w.startMs >= cutMs)]
  }
  return merged.sort((a, b) => a.startMs - b.startMs)
}

export function mergeChunkSegments(results: ChunkSegmentResult[]): TranscriptSegment[] {
  const present = results.filter((r) => r.segments.length > 0)
  if (present.length === 0) return []
  let merged: TranscriptSegment[] = [...present[0]!.segments]
  for (let i = 1; i < present.length; i++) {
    const next = present[i]!
    const overlapStartMs = next.chunk.startS * 1000
    const prevEndMs = present[i - 1]!.chunk.endS * 1000
    const overlapEndMs = Math.min(prevEndMs, next.chunk.endS * 1000)
    if (overlapEndMs <= overlapStartMs) {
      merged = [...merged, ...next.segments]
      continue
    }
    const cutMs = cutAtLargestPauseOrOverlapMidpoint(next.segments, overlapStartMs, overlapEndMs)
    merged = [...merged.filter((s) => s.startMs < cutMs), ...next.segments.filter((s) => s.startMs >= cutMs)]
  }
  return merged.sort((a, b) => a.startMs - b.startMs)
}

function cutAtLargestPauseOrOverlapMidpoint<T extends { startMs: number; endMs: number }>(words: T[], overlapStartMs: number, overlapEndMs: number): number {
  let bestGap = 0
  let bestCut = (overlapStartMs + overlapEndMs) / 2
  const inWindow = words.filter((w) => w.endMs > overlapStartMs && w.startMs < overlapEndMs)
  for (let i = 1; i < inWindow.length; i++) {
    const gap = inWindow[i]!.startMs - inWindow[i - 1]!.endMs
    if (gap > bestGap) {
      bestGap = gap
      bestCut = (inWindow[i - 1]!.endMs + inWindow[i]!.startMs) / 2
    }
  }
  return bestGap >= MIN_OVERLAP_PAUSE_MS ? bestCut : (overlapStartMs + overlapEndMs) / 2
}
