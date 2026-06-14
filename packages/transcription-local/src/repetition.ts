/**
 * Whisper's classic failure mode on silence/noise: the decoder locks into a
 * loop and emits the same phrase over and over. Detect n-gram repetition so
 * the worker can drop the chunk and retry with a temperature bump.
 */

export interface RepetitionOptions {
  /** Longest phrase length (in tokens) checked for looping. Default 4. */
  maxNgram?: number
  /** Consecutive repeats that count as a loop. Default 4 (3 for bigrams+). */
  minRepeats?: number
}

/** True when the token stream ends up looping the same n-gram. */
export function hasRepetitionLoop(tokens: readonly string[], options: RepetitionOptions = {}): boolean {
  const maxNgram = options.maxNgram ?? 4
  const normalized = tokens.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')).filter(Boolean)
  for (let n = 1; n <= maxNgram; n++) {
    // Single tokens repeat legitimately more often than phrases do.
    const needed = options.minRepeats ?? (n === 1 ? 6 : n === 2 ? 4 : 3)
    if (normalized.length < n * needed) continue
    let repeats = 1
    for (let i = n; i + n <= normalized.length; i += n) {
      let same = true
      for (let j = 0; j < n; j++) {
        if (normalized[i + j] !== normalized[i + j - n]) {
          same = false
          break
        }
      }
      repeats = same ? repeats + 1 : 1
      if (repeats >= needed) return true
    }
  }
  return false
}

/** Convenience for plain text output. */
export function textHasRepetitionLoop(text: string, options?: RepetitionOptions): boolean {
  return hasRepetitionLoop(text.split(/\s+/), options)
}
