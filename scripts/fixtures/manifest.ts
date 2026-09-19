import { z } from 'zod'
import type { FixtureRecipe } from './recipes'

const toneSchema = z.object({
  hz: z.number(),
  gain: z.number(),
  beepGain: z.number(),
  beepMs: z.number(),
  beepEveryMs: z.number(),
})

const gapSchema = z.object({ startMs: z.number(), endMs: z.number() })

const expectedSchema = z.object({
  durationMs: z.number(),
  width: z.number(),
  height: z.number(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  tolerance: z.number(),
})

export const recipeSchema = z.object({
  id: z.string(),
  container: z.enum(['mp4', 'mov', 'webm', 'mkv', 'm4a', 'ogg', 'mp3', 'wav', 'flac']),
  videoCodec: z.enum(['h264', 'hevc', 'vp9', 'av1', 'prores']).nullable(),
  audioCodec: z.enum(['aac', 'opus', 'mp3', 'pcm_s16le', 'flac']).nullable(),
  width: z.number(),
  height: z.number(),
  fps: z.union([z.number(), z.literal('vfr')]),
  durationMs: z.number(),
  frameCounter: z.boolean(),
  tone: toneSchema.nullable(),
  silenceGaps: z.array(gapSchema),
  sampleRate: z.number(),
  channels: z.number(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  stillImage: z.boolean(),
  expected: expectedSchema,
}) satisfies z.ZodType<FixtureRecipe>

export const measuredSchema = z.object({
  durationMs: z.number(),
  width: z.number(),
  height: z.number(),
  displayWidth: z.number(),
  displayHeight: z.number(),
  rotation: z.number(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  frames: z.number().nullable(),
  sampleRate: z.number().nullable(),
  channels: z.number().nullable(),
})

export type MeasuredTruth = z.infer<typeof measuredSchema>

const fixtureSchema = z.object({
  id: z.string(),
  file: z.string(),
  recipe: recipeSchema,
  recipeHash: z.string(),
  sha256: z.string().nullable(),
  bytes: z.number(),
  generationMs: z.number(),
  measured: measuredSchema.nullable(),
  skipped: z.string().nullable(),
})

export type ManifestFixture = z.infer<typeof fixtureSchema>

export const mutationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('truncate'), fraction: z.number() }),
  z.object({ kind: z.literal('header-only'), bytes: z.number() }),
  z.object({ kind: z.literal('byte-flip'), seed: z.number(), flips: z.number(), from: z.number(), to: z.number() }),
  z.object({ kind: z.literal('moov-at-end') }),
])

export type Mutation = z.infer<typeof mutationSchema>

const manifestMutationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  file: z.string(),
  sha256: z.string(),
  bytes: z.number(),
  mutationHash: z.string(),
  mutation: mutationSchema,
  expected: z.literal('reject-or-partial'),
})

export type ManifestMutation = z.infer<typeof manifestMutationSchema>

export const manifestSchema = z.object({
  version: z.literal(1),
  ffmpeg: z.string(),
  fixtures: z.array(fixtureSchema),
  mutations: z.array(manifestMutationSchema),
})

export type FixtureManifest = z.infer<typeof manifestSchema>

export function parseManifest(value: unknown): FixtureManifest {
  return manifestSchema.parse(value)
}
