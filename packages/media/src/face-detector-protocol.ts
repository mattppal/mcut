import { z } from 'zod'

const unit = z.number().min(0).max(1)

const requestId = z.number().int().nonnegative()

const faceBoxSchema = z.object({ x: unit, y: unit, w: unit, h: unit })

const faceSampleSchema = z.object({
  sourceMs: z.number().int().nonnegative(),
  box: faceBoxSchema.nullable(),
})

export type FaceBox = z.infer<typeof faceBoxSchema>
export type FaceSample = z.infer<typeof faceSampleSchema>

const ortWasmPathsSchema = z.object({ mjs: z.string(), wasm: z.string() })

export type OrtWasmPaths = z.infer<typeof ortWasmPathsSchema>

const progressSchema = z.object({ phase: z.enum(['model', 'detect']), progress: unit })

export type FaceDetectorProgress = z.infer<typeof progressSchema>

export const faceDetectRequestSchema = z.object({
  type: z.literal('detect'),
  id: requestId,
  src: z.union([z.string(), z.instanceof(Blob)]),
  sampleRateHz: z.number().positive(),
  ortWasmPaths: ortWasmPathsSchema.optional(),
})

export type FaceDetectRequest = z.infer<typeof faceDetectRequestSchema>

export const faceDetectResponseSchema = z.discriminatedUnion('type', [
  progressSchema.extend({ type: z.literal('progress'), id: requestId }),
  z.object({ type: z.literal('result'), id: requestId, samples: z.array(faceSampleSchema) }),
  z.object({ type: z.literal('error'), id: requestId, message: z.string() }),
])

export type FaceDetectResponse = z.infer<typeof faceDetectResponseSchema>
