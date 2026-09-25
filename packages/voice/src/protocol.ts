import { z } from 'zod'

export const chunkRequestSchema = z.object({ samples: z.instanceof(Float32Array), wasm: z.instanceof(WebAssembly.Module) })

export type ChunkRequest = z.infer<typeof chunkRequestSchema>

export const workerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), done: z.number().int().nonnegative() }),
  z.object({ type: z.literal('done'), samples: z.instanceof(Float32Array) }),
  z.object({ type: z.literal('error'), message: z.string() }),
])

export type WorkerMessage = z.infer<typeof workerMessageSchema>
