import { z } from 'zod'

export const retakeOptionsSchema = z.object({
  pauseMs: z.number().int().min(0).default(450).describe('A gap at least this long, or sentence punctuation, starts a new phrase.'),
  minMatchWords: z.number().int().min(2).default(6).describe('A retake repeats at least this many opening words of an earlier phrase.'),
  maxLookaheadMs: z.number().int().min(1000).default(20_000).describe('How far after a phrase start its restart may begin.'),
})

export type RetakeOptions = z.input<typeof retakeOptionsSchema>

interface TimedWord {
  text: string
  startMs: number
  endMs: number
}

export interface RetakeCandidate {
  startMs: number
  endMs: number
  abandonedText: string
  keptText: string
  matchedWords: number
}

const MAX_OPENING_DRIFT = 2

const FILLERS = new Set(['um', 'uh', 'erm', 'ah', 'hmm', 'mm'])

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')

const CONTRACTIONS = new Map<string, readonly string[]>([
  ['gotta', ['got', 'to']],
  ['gonna', ['going', 'to']],
  ['wanna', ['want', 'to']],
])

interface Token {
  norm: string
  word: TimedWord
  opensPhrase: boolean
}

function tokenize(words: readonly TimedWord[], pauseMs: number): Token[] {
  const tokens: Token[] = []
  let pendingBreak = true
  let spokenUntilMs = Number.NEGATIVE_INFINITY
  words.forEach((word, index) => {
    const previous = words[index - 1]
    if (word.startMs - spokenUntilMs >= pauseMs || /[.?!]$/.test(previous?.text.trim() ?? '')) pendingBreak = true
    const norm = normalize(word.text)
    if (norm === '' || FILLERS.has(norm)) return
    spokenUntilMs = word.endMs
    for (const part of CONTRACTIONS.get(norm) ?? [norm]) {
      tokens.push({ norm: part, word, opensPhrase: pendingBreak })
      pendingBreak = false
    }
  })
  return tokens
}

function sharedRun(tokens: readonly Token[], a: number, b: number): { matched: number; keptLength: number } {
  let i = 0
  let j = 0
  let matched = 0
  let skipped = false
  const norm = (index: number) => tokens[index]?.norm
  while (b + j < tokens.length && a + i < b) {
    if (norm(a + i) === norm(b + j)) {
      i++
      j++
      matched++
      continue
    }
    const droppedFromKept = a + i + 1 < b && norm(a + i + 1) === norm(b + j)
    const insertedInKept = norm(a + i) === norm(b + j + 1)
    if (skipped || matched === 0 || !(droppedFromKept || insertedInKept)) break
    skipped = true
    if (droppedFromKept) i++
    if (!droppedFromKept) j++
  }
  return { matched, keptLength: j }
}

const textOf = (tokens: readonly Token[], from: number, to: number) =>
  tokens
    .slice(from, to)
    .filter((token, i, slice) => slice[i - 1]?.word !== token.word)
    .map((t) => t.word.text.trim())
    .join(' ')

export function findRetakes(words: readonly TimedWord[], options: RetakeOptions = {}): RetakeCandidate[] {
  const { pauseMs, minMatchWords, maxLookaheadMs } = retakeOptionsSchema.parse(options)
  const tokens = tokenize(words, pauseMs)
  const starts = tokens.flatMap((token, index) => (token.opensPhrase ? [index] : []))
  const candidates: RetakeCandidate[] = []
  let coveredUntil = -1
  for (const start of starts) {
    const first = tokens[start]
    if (!first || start < coveredUntil) continue
    let restart: { index: number; length: number; matched: number } | null = null
    for (let k = start + minMatchWords; k < tokens.length; k++) {
      const candidate = tokens[k]
      if (!candidate || candidate.word.startMs - first.word.startMs > maxLookaheadMs) break
      for (let offset = 0; offset <= MAX_OPENING_DRIFT && k - offset > start; offset++) {
        if (offset > 0 && !tokens[k - offset]?.opensPhrase) continue
        const run = sharedRun(tokens, start + offset, k)
        if (run.matched >= minMatchWords) {
          restart = { index: k - offset, length: run.keptLength + offset, matched: run.matched + offset }
          break
        }
      }
    }
    if (!restart) continue
    const kept = tokens[restart.index]
    if (!kept) continue
    const previous = candidates.at(-1)
    if (previous && previous.endMs === first.word.startMs) {
      candidates[candidates.length - 1] = {
        ...previous,
        endMs: kept.word.startMs,
        abandonedText: `${previous.abandonedText} ${textOf(tokens, start, restart.index)}`,
        keptText: textOf(tokens, restart.index, restart.index + restart.length),
        matchedWords: restart.matched,
      }
      coveredUntil = restart.index
      continue
    }
    candidates.push({
      startMs: first.word.startMs,
      endMs: kept.word.startMs,
      abandonedText: textOf(tokens, start, restart.index),
      keptText: textOf(tokens, restart.index, restart.index + restart.length),
      matchedWords: restart.matched,
    })
    coveredUntil = restart.index
  }
  return candidates.reverse()
}
