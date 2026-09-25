import { df_create_default, df_get_delay, df_get_frame_length, df_process_frames, initSync } from '../wasm/df.js'
import { chunkRequestSchema, type WorkerMessage } from './protocol'

const ATTENUATION_LIMIT_DB = 100
const FRAMES_PER_PROGRESS = 100

export function denoise(data: unknown, post: (message: WorkerMessage, transfer: ArrayBuffer[]) => void): void {
  try {
    const { samples, wasm } = chunkRequestSchema.parse(data)
    initSync(wasm)
    const state = df_create_default(ATTENUATION_LIMIT_DB)
    const frame = df_get_frame_length(state)
    const delay = df_get_delay(state)
    const block = frame * FRAMES_PER_PROGRESS
    const padded = new Float32Array(Math.ceil((samples.length + delay) / frame) * frame)
    padded.set(samples)
    for (let offset = 0; offset < padded.length; offset += block) {
      padded.set(df_process_frames(state, padded.subarray(offset, offset + block)), offset)
      post({ type: 'progress', done: Math.min(offset + block, samples.length) }, [])
    }
    const output = padded.slice(delay, delay + samples.length)
    post({ type: 'done', samples: output }, [output.buffer])
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) }, [])
  }
}
