import type { TranscriptSegment, TranscriptWord } from '@mcut/transcription'

/**
 * Chunked-streaming plan for long audio: fixed windows with overlap, merged
 * back together on word timestamps. Whisper's native receptive field is 30s;
 * processing window-by-window keeps the tab responsive (progress per chunk)
 * and lets the worker skip non-speech windows and retry hallucinating ones
 * without redoing the whole file.
 */

export interface AudioChunk {
  /** Window start in the source audio, seconds. */
  startS: number
  /** Window end (exclusive), seconds. */
  endS: number
}

export const CHUNK_WINDOW_S = 30
export const CHUNK_OVERLAP_S = 5

/** Split a duration into overlapping windows (last window may be shorter). */
export function planChunks(
  durationS: number,
  windowS = CHUNK_WINDOW_S,
  overlapS = CHUNK_OVERLAP_S,
): AudioChunk[] {
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
  /** Words with ABSOLUTE timestamps (chunk offset already applied), ms. */
  words: TranscriptWord[]
}

export interface ChunkSegmentResult {
  chunk: AudioChunk
  /** Segments with ABSOLUTE timestamps (chunk offset already applied), ms. */
  segments: TranscriptSegment[]
}

/**
 * Merge consecutive chunk transcripts on word timestamps rather than
 * concatenating: inside each overlap the cut lands on the largest silence
 * between the incoming chunk's words (falling back to the overlap midpoint),
 * the outgoing chunk keeps words before the cut, the incoming one after.
 * This absorbs the timestamp drift Whisper accumulates near window edges.
 */
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
    const cutMs = pickCut(next.words, overlapStartMs, overlapEndMs)
    merged = [
      ...merged.filter((w) => w.startMs < cutMs),
      ...next.words.filter((w) => w.startMs >= cutMs),
    ]
  }
  return merged.sort((a, b) => a.startMs - b.startMs)
}

/** Same overlap-cut strategy as {@link mergeChunkWords}, for segment-timed models. */
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
    const cutMs = pickCut(next.segments, overlapStartMs, overlapEndMs)
    merged = [
      ...merged.filter((s) => s.startMs < cutMs),
      ...next.segments.filter((s) => s.startMs >= cutMs),
    ]
  }
  return merged.sort((a, b) => a.startMs - b.startMs)
}

/**
 * The middle of the largest inter-word gap inside the overlap, else the
 * overlap midpoint. Cutting mid-gap (not at a word edge) keeps the two
 * chunks' slightly-drifted copies of the same word from both surviving.
 */
function pickCut<T extends { startMs: number; endMs: number }>(
  words: T[],
  overlapStartMs: number,
  overlapEndMs: number,
): number {
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
  // A real pause beats the midpoint; tiny jitters don't.
  return bestGap >= 120 ? bestCut : (overlapStartMs + overlapEndMs) / 2
}
