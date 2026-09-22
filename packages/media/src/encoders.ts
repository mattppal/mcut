let ready: Promise<void> | null = null

export function ensureFallbackAudioEncoders(): Promise<void> {
  ready ??= (async () => {
    try {
      const { canEncodeAudio } = await import('mediabunny')
      if (!(await canEncodeAudio('aac'))) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
        registerAacEncoder()
      }
    } catch {}
  })()
  return ready
}
