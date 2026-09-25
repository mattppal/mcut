export const VOICE_MODEL = 'dfn3-cli-thresholds-1'

export { VOICE_SAMPLE_RATE, planChunks, type Chunk } from './chunks'
export { mixVoice } from './mix'
export {
  VoiceWorkerError,
  cleanVoice,
  type CleanVoiceOptions,
  type SpawnWorker,
  type VoiceProgress,
  type VoiceRuntime,
  type VoiceWorker,
  type VoiceWorkerListeners,
} from './pool'
export { decodeWav, encodeWav } from './wav'
