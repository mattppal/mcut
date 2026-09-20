import { z } from 'zod'

export const embedOptionsSchema = z.object({
  clip: z.string().min(1),
  autoplay: z.boolean(),
  muted: z.boolean(),
})

export type EmbedOptions = z.infer<typeof embedOptionsSchema>

export function readEmbedOptions(search: string): EmbedOptions | null {
  const params = new URLSearchParams(search)
  const parsed = embedOptionsSchema.safeParse({
    clip: params.get('clip') ?? '',
    autoplay: params.get('autoplay') === '1',
    muted: params.get('muted') === '1',
  })
  return parsed.success ? parsed.data : null
}

export const parentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mcut:embed:play') }),
  z.object({ type: z.literal('mcut:embed:pause') }),
  z.object({ type: z.literal('mcut:embed:layout'), compact: z.boolean() }),
])

export type ParentMessage = z.infer<typeof parentMessageSchema>

export type EmbedMessage = { type: 'mcut:embed:ready' } | { type: 'mcut:embed:playing'; playing: boolean }

export function postToParent(message: EmbedMessage): void {
  if (window.parent === window) return
  window.parent.postMessage(message, window.location.origin)
}
