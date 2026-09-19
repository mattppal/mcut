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

export const desktopInfoSchema = z.object({
  appVersion: z.string(),
  platform: z.enum(['darwin', 'linux']),
  mcp: z.object({ url: z.url(), cursorInstallUrl: z.url() }),
  transcription: z.object({ configured: z.boolean() }),
})

export type DesktopInfo = z.infer<typeof desktopInfoSchema>

const transcriptionStateSchema = z.object({ configured: z.boolean() })

export const DESKTOP_INVOKES = {
  'app.info': { input: z.undefined(), output: desktopInfoSchema },
  'app.setTranscriptionKey': { input: z.object({ key: z.string() }), output: transcriptionStateSchema },
  'project.open': { input: z.undefined(), output: z.object({ project: projectSchema, path: z.string() }) },
  'project.save': { input: z.object({ project: projectSchema, path: z.string().nullable() }), output: z.object({ path: z.string() }) },
} as const

export type DesktopInvokeChannel = keyof typeof DESKTOP_INVOKES

export type InvokeInput<C extends DesktopInvokeChannel> = z.output<(typeof DESKTOP_INVOKES)[C]['input']>

export type InvokeOutput<C extends DesktopInvokeChannel> = z.output<(typeof DESKTOP_INVOKES)[C]['output']>

export type InvokeHandlers = { [C in DesktopInvokeChannel]: (input: InvokeInput<C>) => Promise<InvokeOutput<C>> }

export type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: DesktopErrorShape }

export function invokeResultSchema<T>(output: z.ZodType<T>): z.ZodType<DesktopResult<T>> {
  return z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: output }), z.object({ ok: z.literal(false), error: desktopErrorSchema })])
}

export function isDesktopInvokeChannel(value: string): value is DesktopInvokeChannel {
  return Object.hasOwn(DESKTOP_INVOKES, value)
}
