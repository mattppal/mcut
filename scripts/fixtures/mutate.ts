import type { Mutation } from './manifest'
import type { Container } from './recipes'

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash === 0 ? 1 : hash
}

export function xorshift32(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state
  }
}

export interface MutationVariant {
  suffix: string
  mutation: Mutation
}

const HEADER_BYTES = 4096
const MIN_FLIPS = 16
const BYTES_PER_FLIP = 4096
const isoContainers: ReadonlySet<Container> = new Set<Container>(['mp4', 'm4a', 'mov'])

export function variantsFor(id: string, container: Container, bytes: number): MutationVariant[] {
  const variants: MutationVariant[] = [
    { suffix: 'trunc50', mutation: { kind: 'truncate', fraction: 0.5 } },
    { suffix: 'trunc10', mutation: { kind: 'truncate', fraction: 0.1 } },
    {
      suffix: 'flip',
      mutation: {
        kind: 'byte-flip',
        seed: fnv1a(id),
        flips: Math.max(MIN_FLIPS, Math.floor(bytes / BYTES_PER_FLIP)),
        from: 0.1,
        to: 0.9,
      },
    },
  ]
  if (bytes > HEADER_BYTES) variants.push({ suffix: 'head4k', mutation: { kind: 'header-only', bytes: HEADER_BYTES } })
  if (isoContainers.has(container)) variants.push({ suffix: 'moovend', mutation: { kind: 'moov-at-end' } })
  return variants
}

export function flipBytes(source: Uint8Array, seed: number, flips: number, from: number, to: number): Uint8Array {
  const next = xorshift32(seed)
  const copy = new Uint8Array(source)
  const start = Math.floor(source.length * from)
  const span = Math.max(1, Math.floor(source.length * (to - from)))
  for (let i = 0; i < flips; i++) {
    const position = start + (next() % span)
    const mask = next() & 0xff
    copy[position] = (copy[position] ?? 0) ^ (mask === 0 ? 0xff : mask)
  }
  return copy
}

export function applyByteMutation(source: Uint8Array, mutation: Mutation): Uint8Array | null {
  if (mutation.kind === 'truncate') return source.slice(0, Math.floor(source.length * mutation.fraction))
  if (mutation.kind === 'header-only') return source.slice(0, mutation.bytes)
  if (mutation.kind === 'byte-flip') return flipBytes(source, mutation.seed, mutation.flips, mutation.from, mutation.to)
  return null
}
