import { probeMedia } from '@mcut/media'

export type InPageProbe =
  | {
      ok: true
      durationMs: number
      width: number | null
      height: number | null
      hasVideo: boolean
      hasAudio: boolean
    }
  | { ok: false; name: string; message: string }

declare global {
  interface Window {
    __mcutMediaFuzz: { probe: (base64: string, type: string) => Promise<InPageProbe> }
  }
}

function toBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

window.__mcutMediaFuzz = {
  async probe(base64, type) {
    try {
      const probe = await probeMedia(toBlob(base64, type))
      return {
        ok: true,
        durationMs: probe.durationMs,
        width: probe.width ?? null,
        height: probe.height ?? null,
        hasVideo: probe.hasVideo,
        hasAudio: probe.hasAudio,
      }
    } catch (error) {
      return {
        ok: false,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  },
}
