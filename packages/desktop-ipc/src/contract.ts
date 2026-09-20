import { projectSchema } from '@mcut/timeline'
import { z } from 'zod'

export const desktopErrorSchema = z.object({
  code: z.enum(['cancelled', 'not-found', 'io', 'transcription', 'internal']),
  message: z.string(),
})

export type DesktopErrorShape = z.infer<typeof desktopErrorSchema>

export type DesktopErrorCode = DesktopErrorShape['code']

export class DesktopError extends Error {
  readonly code: DesktopErrorCode

  constructor(code: DesktopErrorCode, message: string) {
    super(message)
    this.name = 'DesktopError'
    this.code = code
  }
}

export const desktopPlatformSchema = z.enum(['darwin', 'linux'])

export type DesktopPlatform = z.infer<typeof desktopPlatformSchema>

export const desktopInfoSchema = z.object({
  appVersion: z.string(),
  platform: desktopPlatformSchema,
  mcp: z.object({ url: z.url(), cursorInstallUrl: z.url() }),
  transcription: z.object({ configured: z.boolean() }),
})

export type DesktopInfo = z.infer<typeof desktopInfoSchema>

const transcriptionStateSchema = z.object({ configured: z.boolean() })

export const updateStateSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('idle') }),
  z.object({ phase: z.literal('available'), version: z.string(), notes: z.string().nullable() }),
  z.object({ phase: z.literal('downloading'), version: z.string(), percent: z.number().min(0).max(100) }),
  z.object({ phase: z.literal('ready'), version: z.string() }),
  z.object({ phase: z.literal('failed'), version: z.string(), message: z.string() }),
])

export type UpdateState = z.infer<typeof updateStateSchema>

export const DESKTOP_INVOKES = {
  'app.info': { input: z.undefined(), output: desktopInfoSchema },
  'app.setTranscriptionKey': { input: z.object({ key: z.string() }), output: transcriptionStateSchema },
  'project.open': { input: z.undefined(), output: z.object({ project: projectSchema, path: z.string() }) },
  'project.save': { input: z.object({ project: projectSchema, path: z.string().nullable() }), output: z.object({ path: z.string() }) },
  'update.download': { input: z.undefined(), output: updateStateSchema },
  'update.install': { input: z.undefined(), output: updateStateSchema },
} as const

export type DesktopInvokeChannel = keyof typeof DESKTOP_INVOKES

export type InvokeInput<C extends DesktopInvokeChannel> = z.output<(typeof DESKTOP_INVOKES)[C]['input']>

export type InvokeOutput<C extends DesktopInvokeChannel> = z.output<(typeof DESKTOP_INVOKES)[C]['output']>

export type InvokeHandlers = { [C in DesktopInvokeChannel]: (input: InvokeInput<C>) => Promise<InvokeOutput<C>> }

export type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: DesktopErrorShape }

export function invokeResultSchema<T>(output: z.ZodType<T>): z.ZodType<DesktopResult<T>> {
  return z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: output }), z.object({ ok: z.literal(false), error: desktopErrorSchema })])
}
