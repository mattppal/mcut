import { z } from 'zod'

export const jsonObjectSchema = z.record(z.string(), z.unknown())

export type JsonObject = z.infer<typeof jsonObjectSchema>

export type JsonObjectResult = { ok: true; value: JsonObject } | { ok: false; message: string }

export function parseJsonObject(text: string): JsonObjectResult {
  try {
    return { ok: true, value: jsonObjectSchema.parse(JSON.parse(text)) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Expected a JSON object. ${message}` }
  }
}
