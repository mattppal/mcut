import { z } from 'zod'

const importMediaBridgeFileSchema = z.strictObject({
  url: z.url(),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.int().nonnegative(),
  path: z.string().min(1),
})

export const importMediaBridgePayloadSchema = z.strictObject({
  files: z.array(importMediaBridgeFileSchema).min(1).max(50),
})

const importedMediaFileSchema = z.strictObject({
  path: z.string(),
  assetId: z.string(),
  name: z.string(),
  kind: z.enum(['video', 'audio', 'image']),
  durationMs: z.int().nonnegative().optional(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
})

const mediaImportFailureSchema = z.strictObject({
  path: z.string(),
  error: z.string(),
})

export const mediaImportReportSchema = z.strictObject({
  imported: z.array(importedMediaFileSchema),
  failed: z.array(mediaImportFailureSchema),
})

export type MediaImportReport = z.infer<typeof mediaImportReportSchema>

export type ImportMediaBridgeFile = z.infer<typeof importMediaBridgeFileSchema>
