import type { MediaProbe } from '../probe'
import type { FuzzEntry, ManifestFixture } from './fixtures'
import type { ProbeOutcome } from './probe-runner'

export interface Violation {
  invariant: string
  detail: string
}

const describeProbe = (probe: MediaProbe): string =>
  `durationMs ${probe.durationMs}, ${probe.width ?? '-'}x${probe.height ?? '-'}, ` +
  `video ${probe.hasVideo}, audio ${probe.hasAudio}, mime ${probe.mimeType ?? '-'}`

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0

function settled(outcome: ProbeOutcome, timeoutMs: number): Violation[] {
  if (outcome.kind === 'hang') {
    return [{ invariant: 'settles', detail: `probeMedia neither resolved nor rejected within ${timeoutMs} ms` }]
  }
  if (outcome.kind === 'crash') {
    return [{ invariant: 'settles', detail: `probeMedia escaped its promise chain with ${outcome.message}` }]
  }
  if (outcome.kind === 'threw' && !outcome.typed) {
    return [{ invariant: 'typed-rejection', detail: `rejected with ${outcome.name} (${outcome.message}), not a MediaProbeError` }]
  }
  return []
}

function matchesTruth(fixture: ManifestFixture, outcome: ProbeOutcome): Violation[] {
  const expected = fixture.recipe.expected
  if (outcome.kind === 'threw') {
    return [{ invariant: 'valid-file-probes', detail: `rejected a valid file with ${outcome.name} (${outcome.message})` }]
  }
  if (outcome.kind !== 'probe') return []
  const { probe } = outcome
  const violations: Violation[] = []
  const drift = Math.abs(probe.durationMs - expected.durationMs)
  if (drift > expected.tolerance) {
    violations.push({
      invariant: 'duration-within-tolerance',
      detail: `durationMs ${probe.durationMs} is ${drift} ms from ${expected.durationMs} (tolerance ${expected.tolerance})`,
    })
  }
  if (probe.hasVideo !== expected.hasVideo || probe.hasAudio !== expected.hasAudio) {
    violations.push({
      invariant: 'tracks-match',
      detail: `video ${probe.hasVideo}, audio ${probe.hasAudio}; expected video ${expected.hasVideo}, audio ${expected.hasAudio}`,
    })
  }
  const expectedWidth = expected.hasVideo ? expected.width : undefined
  const expectedHeight = expected.hasVideo ? expected.height : undefined
  if (probe.width !== expectedWidth || probe.height !== expectedHeight) {
    violations.push({
      invariant: 'dimensions-match',
      detail: `${probe.width ?? '-'}x${probe.height ?? '-'}; expected ${expectedWidth ?? '-'}x${expectedHeight ?? '-'}`,
    })
  }
  return violations
}

function plausible(entry: Extract<FuzzEntry, { kind: 'mutation' }>, outcome: ProbeOutcome): Violation[] {
  if (outcome.kind !== 'probe') return []
  const { probe } = outcome
  const violations: Violation[] = []
  const sizes = probe.hasVideo ? [probe.width ?? -1, probe.height ?? -1] : []
  if (!isCount(probe.durationMs) || sizes.some((size) => !isCount(size) || size === 0)) {
    violations.push({ invariant: 'sane-probe', detail: describeProbe(probe) })
  }
  const mutation = entry.mutation.mutation
  const source = entry.source.recipe.expected
  const prefix = mutation.kind === 'truncate' || mutation.kind === 'header-only'
  if (prefix && probe.durationMs > source.durationMs + source.tolerance) {
    violations.push({
      invariant: 'truncated-duration-bounded',
      detail: `a prefix of a ${source.durationMs} ms file reports durationMs ${probe.durationMs}`,
    })
  }
  const hasTracks = probe.hasVideo || probe.hasAudio
  if (mutation.kind === 'truncate' && mutation.fraction >= 0.5 && hasTracks && probe.durationMs === 0) {
    violations.push({
      invariant: 'truncated-duration-positive',
      detail: `the first ${mutation.fraction * 100}% of a ${source.durationMs} ms file has intact tracks yet reports durationMs 0`,
    })
  }
  return violations
}

export function checkProbeInvariants(entry: FuzzEntry, outcome: ProbeOutcome, timeoutMs: number): Violation[] {
  const violations = settled(outcome, timeoutMs)
  if (entry.kind === 'fixture') return [...violations, ...matchesTruth(entry.fixture, outcome)]
  if (entry.mutation.mutation.kind === 'moov-at-end') return [...violations, ...matchesTruth(entry.source, outcome)]
  return [...violations, ...plausible(entry, outcome)]
}
