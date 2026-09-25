import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VOICE_SAMPLE_RATE } from '../src/chunks'
import { encodeWav } from '../src/wav'

const SECONDS = 3
const FORMANTS = [
  { center: 700, width: 110 },
  { center: 1_220, width: 90 },
  { center: 2_600, width: 160 },
]
const fixtures = join(import.meta.dirname, '..', 'test', 'fixtures')

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

function noisyVoice(): Float32Array {
  const random = mulberry32(5215)
  const samples = new Float32Array(SECONDS * VOICE_SAMPLE_RATE)
  let phase = 0
  for (let index = 0; index < samples.length; index++) {
    const time = index / VOICE_SAMPLE_RATE
    const pitch = 150 + 25 * Math.sin(2 * Math.PI * 0.7 * time)
    phase += (2 * Math.PI * pitch) / VOICE_SAMPLE_RATE
    const onset = Math.min(1, Math.max(0, (time - 1) / 0.05))
    const syllables = Math.max(0, Math.sin(2 * Math.PI * 4 * time)) ** 0.6
    let voice = 0
    for (let harmonic = 1; harmonic <= 50 && harmonic * pitch <= 8_000; harmonic++) {
      const resonance = FORMANTS.reduce((sum, { center, width }) => sum + 1 / (1 + ((harmonic * pitch - center) / width) ** 2), 0)
      voice += (resonance / harmonic) * Math.sin(harmonic * phase)
    }
    samples[index] = (random() * 2 - 1) * 0.05 + 0.6 * onset * syllables * voice
  }
  return samples
}

const [deepFilter] = process.argv.slice(2)
if (deepFilter === undefined) throw new Error('usage: bun scripts/make-fixtures.ts <path to the deep-filter binary>')
mkdirSync(fixtures, { recursive: true })
const input = join(fixtures, 'input.wav')
writeFileSync(input, encodeWav(noisyVoice(), VOICE_SAMPLE_RATE))
const output = mkdtempSync(join(tmpdir(), 'mcut-voice-'))
const native = Bun.spawnSync([deepFilter, '-D', '-o', output, input], { stdout: 'inherit', stderr: 'inherit' })
if (native.exitCode !== 0) throw new Error(`deep-filter exited with code ${native.exitCode}`)
writeFileSync(join(fixtures, 'native.wav'), readFileSync(join(output, 'input.wav')))
