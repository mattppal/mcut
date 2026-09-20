import { z } from 'zod'
import { desktopPlatformSchema, type DesktopInfo, type DesktopPlatform, type DesktopResult, type InvokeInput, type InvokeOutput } from './contract'

const menuActionSchema = z.enum(['project.open', 'project.save', 'project.saveAs'])

export type MenuAction = z.infer<typeof menuActionSchema>

export const menuMessageSchema = z.object({ action: menuActionSchema })

export interface DesktopApi {
  version: 1
  platform: DesktopPlatform
  info(): Promise<DesktopResult<DesktopInfo>>
  setTranscriptionKey(key: string): Promise<DesktopResult<InvokeOutput<'app.setTranscriptionKey'>>>
  projects: {
    open(): Promise<DesktopResult<InvokeOutput<'project.open'>>>
    save(input: InvokeInput<'project.save'>): Promise<DesktopResult<InvokeOutput<'project.save'>>>
  }
  onMenu(callback: (action: MenuAction) => void): void
}

const exposedFunction = <F>() => z.custom<F>((value) => typeof value === 'function')

const desktopApiSchema = z.object({
  version: z.literal(1),
  platform: desktopPlatformSchema,
  info: exposedFunction<DesktopApi['info']>(),
  setTranscriptionKey: exposedFunction<DesktopApi['setTranscriptionKey']>(),
  projects: z.object({
    open: exposedFunction<DesktopApi['projects']['open']>(),
    save: exposedFunction<DesktopApi['projects']['save']>(),
  }),
  onMenu: exposedFunction<DesktopApi['onMenu']>(),
})

export function readDesktopApi(): DesktopApi | null {
  const candidate: unknown = Reflect.get(globalThis, 'mcutDesktop')
  const parsed = desktopApiSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
