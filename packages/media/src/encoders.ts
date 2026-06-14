import { canEncodeAudio } from 'mediabunny'

let ready: Promise<void> | null = null

/**
 * Register WASM fallback encoders for codecs the runtime cannot encode
 * natively — today that's AAC on Firefox (no AudioEncoder AAC support), via
 * `@mediabunny/aac-encoder` (FFmpeg-based). The import is dynamic so
 * browsers with native AAC never download the WASM. Idempotent; export
 * paths await it before probing codecs.
 */
export function ensureFallbackAudioEncoders(): Promise<void> {
  ready ??= (async () => {
    try {
      if (!(await canEncodeAudio('aac'))) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
        registerAacEncoder()
      }
    } catch {
      // No fallback available: export support probing reports audio: false.
    }
  })()
  return ready
}
