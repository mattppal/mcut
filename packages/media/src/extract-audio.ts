import {
  BufferTarget,
  Conversion,
  Output,
  WavOutputFormat,
  type ConversionAudioOptions,
} from 'mediabunny'
import { inputFor, type MediaSourceLike } from './probe'

export interface ExtractAudioOptions {
  sampleRate?: number
  numberOfChannels?: number
  onProgress?: (progress: number) => void
}

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

  const resampled: ConversionAudioOptions = {
    codec: 'pcm-s16',
    sampleRate: options.sampleRate ?? 16_000,
    numberOfChannels: options.numberOfChannels ?? 1,
  }
  const atSourceRateAndChannels: ConversionAudioOptions = { codec: 'pcm-s16' }
  try {
    return await runWavConversion(src, resampled, options.onProgress)
  } catch (error) {
    if (error instanceof AudioNotDecodableError) throw error
    return await runWavConversion(src, atSourceRateAndChannels, options.onProgress)
  }
}
