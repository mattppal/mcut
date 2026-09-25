import { z } from 'zod'

export const exportFormatSchema = z.enum(['mp4', 'webm', 'mkv'])

export type ExportFormat = z.infer<typeof exportFormatSchema>

const exportPhaseSchema = z.enum(['audio', 'video', 'finalize'])

export type ExportPhase = z.infer<typeof exportPhaseSchema>

const jobIdInput = z.string().min(1).describe('Export job id from export_video. Defaults to the newest job.').optional()

export const exportVideoInputSchema = z.strictObject({
  format: exportFormatSchema.describe('Container. Defaults to the outputPath extension, else mp4 when Studio can encode H.264, else webm.').optional(),
  outputPath: z
    .string()
    .min(1)
    .describe('Absolute path of the file to write. Its folder must exist. Defaults to the project name in the export folder, Downloads on desktop.')
    .optional(),
})

export const getExportInputSchema = z.strictObject({
  jobId: jobIdInput,
  waitMs: z.int().min(0).max(25_000).describe('Wait up to this long for the job to finish before answering. Pass 20000 while it renders.').optional(),
})

export const cancelExportInputSchema = z.strictObject({ jobId: jobIdInput })

export const startExportRequestSchema = z.strictObject({
  jobId: z.string().min(1),
  format: exportFormatSchema.optional(),
  uploadUrl: z.url(),
})

export const startExportReplySchema = z.object({
  format: exportFormatSchema,
  filename: z.string(),
  durationMs: z.number().positive(),
})

export type StartExportReply = z.infer<typeof startExportReplySchema>

export const cancelExportRequestSchema = z.strictObject({ jobId: z.string().min(1) })

export const exportFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('export_progress'),
    payload: z.object({ jobId: z.string(), phase: exportPhaseSchema, progress: z.number().min(0).max(1) }),
  }),
  z.object({
    type: z.literal('export_failed'),
    payload: z.object({ jobId: z.string(), message: z.string(), cancelled: z.boolean() }),
  }),
])

export type ExportFrame = z.infer<typeof exportFrameSchema>

export const exportUploadReplySchema = z.union([z.object({ path: z.string(), bytes: z.int().min(0) }), z.object({ ok: z.literal(false), error: z.string() })])

export type ExportUploadReply = z.infer<typeof exportUploadReplySchema>
