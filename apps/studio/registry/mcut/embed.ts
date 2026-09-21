import { z } from 'zod'

export const embedOptionsSchema = z.object({
  clip: z.string().min(1),
  autoplay: z.boolean(),
  muted: z.boolean(),
})

export type EmbedOptions = z.infer<typeof embedOptionsSchema>

export const EMBED_OMISSIONS = [
  {
    id: 'session-persistence',
    reason:
      "Saving the demo project and panel layout into a visitor's IndexedDB and localStorage would leave homepage state behind with no restore flow on the site.",
    selector: '[aria-label="Restore previous session"]',
  },
  {
    id: 'live-mcp-bridge',
    reason: 'The live bridge is a 127.0.0.1 server in the desktop main process, which the site has no equivalent of.',
  },
  {
    id: 'transcription-key-settings',
    reason:
      'The AssemblyAI key lives in the desktop main process behind safeStorage and IPC. The site has no secret store, so the captions panel has no key field.',
    selector: '[data-slot="transcription-key-field"]',
  },
  {
    id: 'window-chrome',
    reason: 'An iframe has no title bar or traffic lights, so the header renders the browser chrome variant instead of mac or linux.',
    selector: 'html[data-window-chrome]',
  },
] as const satisfies ReadonlyArray<{ id: string; reason: string; selector?: string }>

export type EmbedOmission = (typeof EMBED_OMISSIONS)[number]['id']

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
