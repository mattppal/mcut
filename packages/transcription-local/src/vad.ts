const FRAME_S = 0.03
const ACTIVE_FRAME_RMS = 0.004
const MIN_SPEECH_PEAK_RMS = 0.006
const MIN_SPEECH_ACTIVE_FRACTION = 0.01

export interface SpeechActivity {
  activeFraction: number
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
    if (rms > ACTIVE_FRAME_RMS) active++
    frames++
  }
  return { activeFraction: frames > 0 ? active / frames : 0, peakRms: peak }
}

export function hasSpeech(samples: Float32Array, sampleRate: number): boolean {
  const { activeFraction, peakRms } = measureActivity(samples, sampleRate)
  return peakRms >= MIN_SPEECH_PEAK_RMS && activeFraction >= MIN_SPEECH_ACTIVE_FRACTION
}
