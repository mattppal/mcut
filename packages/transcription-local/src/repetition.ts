export interface RepetitionOptions {
  maxNgram?: number
  minRepeats?: number
}

function repeatsNeededForNgram(n: number, minRepeats: number | undefined): number {
  if (minRepeats !== undefined) return minRepeats
  if (n === 1) return 6
  if (n === 2) return 4
  return 3
}

export function hasRepetitionLoop(tokens: readonly string[], options: RepetitionOptions = {}): boolean {
  const maxNgram = options.maxNgram ?? 4
  const normalized = tokens.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')).filter(Boolean)
  for (let n = 1; n <= maxNgram; n++) {
    const needed = repeatsNeededForNgram(n, options.minRepeats)
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

export function textHasRepetitionLoop(text: string, options?: RepetitionOptions): boolean {
  return hasRepetitionLoop(text.split(/\s+/), options)
}
