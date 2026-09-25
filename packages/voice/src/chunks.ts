export const VOICE_SAMPLE_RATE = 48_000

const FRAME = 480
const PREROLL = VOICE_SAMPLE_RATE
const POSTROLL = 2_400
const CROSSFADE = 480
const HALF_CROSSFADE = CROSSFADE / 2

export type Chunk = { from: number; to: number; start: number; end: number }

export type CleanedChunk = Chunk & { samples: Float32Array }

export function planChunks(length: number, workers: number): Chunk[] {
  const count = Math.max(1, Math.min(Math.floor(workers), Math.floor(length / PREROLL)))
  const body = Math.floor(length / count / FRAME) * FRAME
  return Array.from({ length: count }, (_, index) => {
    const start = index * body
    const end = index === count - 1 ? length : start + body
    return { from: Math.max(0, start - PREROLL), to: Math.min(length, end + POSTROLL), start, end }
  })
}

export function stitchChunks(chunks: readonly CleanedChunk[], length: number): Float32Array<ArrayBuffer> {
  const stitched = new Float32Array(length)
  chunks.forEach((chunk, index) => {
    const keepFrom = chunk.start === 0 ? 0 : chunk.start + HALF_CROSSFADE
    const keepTo = chunk.end === length ? length : chunk.end - HALF_CROSSFADE
    stitched.set(chunk.samples.subarray(keepFrom - chunk.from, keepTo - chunk.from), keepFrom)
    const previous = chunks[index - 1]
    if (previous !== undefined) crossfade(stitched, previous, chunk)
  })
  return stitched
}

function crossfade(target: Float32Array, outgoing: CleanedChunk, incoming: CleanedChunk): void {
  for (let at = incoming.start - HALF_CROSSFADE; at < incoming.start + HALF_CROSSFADE; at++) {
    const weight = (at - incoming.start + HALF_CROSSFADE + 0.5) / CROSSFADE
    const before = outgoing.samples[at - outgoing.from] ?? 0
    const after = incoming.samples[at - incoming.from] ?? 0
    target[at] = (1 - weight) * before + weight * after
  }
}
