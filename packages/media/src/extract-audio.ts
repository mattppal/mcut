import {
  BufferTarget,
  Conversion,
  Output,
  WavOutputFormat,
  type ConversionAudioOptions,
} from 'mediabunny'
import { inputFor, type MediaSourceLike } from './probe'

export interface ExtractAudioOptions {
  /** Default 16000 — small uploads, ideal for speech-to-text APIs. */
  sampleRate?: number
  /** Default 1 (mono). */
  numberOfChannels?: number
  onProgress?: (progress: number) => void
}

/** The file's audio exists but this browser has no decoder for its codec. */
export class AudioNotDecodableError extends Error {
  constructor(codec: string | undefined) {
    super(
      `This browser cannot decode the clip's audio${codec ? ` (${codec})` : ''}. ` +
        'Try re-encoding the file as MP4/AAC.',
    )
    this.name = 'AudioNotDecodableError'
  }
}

async function runWavConversion(
  src: MediaSourceLike,
  audio: ConversionAudioOptions,
  onProgress?: (progress: number) => void,
): Promise<Blob | null> {
  const input = inputFor(src)
  try {
    const target = new BufferTarget()
    const output = new Output({ format: new WavOutputFormat(), target })
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio,
      showWarnings: false,
    })
    if (!conversion.isValid) {
      // The only discard we didn't ask for is the audio track itself —
      // surface WHY instead of Mediabunny's generic invalid-conversion error.
      const audioDiscard = conversion.discardedTracks.find((d) => d.track.type === 'audio')
      if (audioDiscard?.reason === 'undecodable_source_codec') {
        throw new AudioNotDecodableError(audioDiscard.track.codec ?? undefined)
      }
      throw new Error(
        `Audio conversion is not possible for this file` +
          (audioDiscard ? ` (${audioDiscard.reason})` : ''),
      )
    }
    if (onProgress) conversion.onProgress = onProgress
    await conversion.execute()
    if (!target.buffer) return null
    return new Blob([target.buffer], { type: 'audio/wav' })
  } finally {
    input.dispose()
  }
}

/**
 * Extract a file's audio track to a PCM WAV blob, fully client-side.
 * Returns `null` when the file has no audio track. The default
 * 16 kHz/mono output keeps uploads to transcription APIs small.
 *
 * Resilience: when the resampled conversion fails (Mediabunny's resampler /
 * channel mixer can throw "Assertion failed." on unusual source layouts),
 * retry once WITHOUT resampling — the WAV is bigger but transcription APIs
 * accept any PCM rate. Undecodable codecs fail fast with a clear error.
 */
export async function extractAudioToWav(
  src: MediaSourceLike,
  options: ExtractAudioOptions = {},
): Promise<Blob | null> {
  const probe = inputFor(src)
  try {
    const audioTrack = await probe.getPrimaryAudioTrack()
    if (!audioTrack) return null
  } finally {
    probe.dispose()
  }

  try {
    return await runWavConversion(
      src,
      {
        codec: 'pcm-s16',
        sampleRate: options.sampleRate ?? 16_000,
        numberOfChannels: options.numberOfChannels ?? 1,
      },
      options.onProgress,
    )
  } catch (error) {
    if (error instanceof AudioNotDecodableError) throw error
    return await runWavConversion(src, { codec: 'pcm-s16' }, options.onProgress)
  }
}
