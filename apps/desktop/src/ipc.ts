import { DESKTOP_INVOKES, DesktopError, type DesktopInvokeChannel, type DesktopResult, type InvokeHandlers } from '@mcut/desktop-ipc'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

export interface DesktopIpcOptions {
  allowedOrigins: readonly string[]
}

function senderAllowed(event: IpcMainInvokeEvent, allowedOrigins: readonly string[]): boolean {
  const url = event.senderFrame?.url
  return url !== undefined && allowedOrigins.some((origin) => url === origin || url.startsWith(`${origin}/`))
}

function failure(error: unknown): DesktopResult<never> {
  if (error instanceof DesktopError) return { ok: false, error: { code: error.code, message: error.message } }
  return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }
}

function register<Input>(
  channel: DesktopInvokeChannel,
  input: z.ZodType<Input>,
  handler: (input: Input) => Promise<unknown>,
  options: DesktopIpcOptions,
): void {
  ipcMain.handle(channel, async (event, raw: unknown): Promise<DesktopResult<unknown>> => {
    if (!senderAllowed(event, options.allowedOrigins)) {
      return failure(new DesktopError('internal', `${channel} rejected a sender at ${event.senderFrame?.url ?? 'an unknown frame'}.`))
    }
    const parsed = input.safeParse(raw)
    if (!parsed.success) return failure(new DesktopError('internal', `${channel} received a malformed input. ${z.prettifyError(parsed.error)}`))
    try {
      return { ok: true, value: await handler(parsed.data) }
    } catch (error) {
      return failure(error)
    }
  })
}

export function registerDesktopIpc(handlers: InvokeHandlers, options: DesktopIpcOptions): void {
  const registrations: Record<DesktopInvokeChannel, () => void> = {
    'app.info': () => register('app.info', DESKTOP_INVOKES['app.info'].input, handlers['app.info'], options),
    'app.setTranscriptionKey': () =>
      register('app.setTranscriptionKey', DESKTOP_INVOKES['app.setTranscriptionKey'].input, handlers['app.setTranscriptionKey'], options),
    'project.open': () => register('project.open', DESKTOP_INVOKES['project.open'].input, handlers['project.open'], options),
    'project.save': () => register('project.save', DESKTOP_INVOKES['project.save'].input, handlers['project.save'], options),
    'update.download': () => register('update.download', DESKTOP_INVOKES['update.download'].input, handlers['update.download'], options),
    'update.install': () => register('update.install', DESKTOP_INVOKES['update.install'].input, handlers['update.install'], options),
  }
  for (const start of Object.values(registrations)) start()
}
