/**
 * Lightweight energy-based voice activity pre-pass: windows that are
 * essentially silent never reach the model, which is where Whisper
 * hallucinates text. Deliberately conservative — it only skips clear
 * silence, anything ambiguous (music, low speech) still gets transcribed.
 * The seam is shaped so a silero-vad WASM pass can replace it later.
 */

const FRAME_S = 0.03

export interface SpeechActivity {
  /** Fraction of frames above the activity threshold (0–1). */
  activeFraction: number
  /** Peak frame RMS. */
  peakRms: number
}

export function measureActivity(samples: Float32Array, sampleRate: number): SpeechActivity {
  const frameLength = Math.max(1, Math.round(sampleRate * FRAME_S))
  let active = 0
  let frames = 0
  let peak = 0
  for (let start = 0; start < samples.length; start += frameLength) {
    const end = Math.min(samples.length, start + frameLength)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    peak = Math.max(peak, rms)
    if (rms > 0.004) active++
    frames++
  }
  return { activeFraction: frames > 0 ? active / frames : 0, peakRms: peak }
}

/** Whether a window plausibly contains any speech at all. */
export function hasSpeech(samples: Float32Array, sampleRate: number): boolean {
  const { activeFraction, peakRms } = measureActivity(samples, sampleRate)
  return peakRms >= 0.006 && activeFraction >= 0.01
}
