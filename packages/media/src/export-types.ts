import type { ElementId, Project } from '@mcut/timeline'
import type { Quality } from 'mediabunny'
import type { ContainerFormatId } from './container-formats'

export type { ContainerFormatId } from './container-formats'

export interface ExportProgress {
  progress: number
  phase: 'audio' | 'video' | 'finalize'
}

export interface ExportFontFaceInit {
  family: string
  weight?: string
  style?: string
  unicodeRange?: string
  source: ArrayBuffer | string
}

export interface ExportProjectOptions {
  format?: ContainerFormatId
  videoBitrate?: number | Quality
  fonts?: ExportFontFaceInit[]
  audioSources?: ReadonlyMap<ElementId, string>
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  extension: string
}

export const AUDIO_SAMPLE_RATE = 48_000

export interface MixedAudioData {
  left: Float32Array<ArrayBuffer>
  right: Float32Array<ArrayBuffer>
  sampleRate: number
}

export interface WorkerExportOptions {
  format?: ContainerFormatId
  videoBitrate?: number
}

export interface ExportWorkerStartMessage {
  type: 'start'
  project: Project
  options: WorkerExportOptions
  mixedAudio: MixedAudioData | null
  fonts: ExportFontFaceInit[]
}

export type ExportWorkerRequest = ExportWorkerStartMessage

export type ExportWorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; progress: number; phase: ExportProgress['phase'] }
  | { type: 'done'; buffer: ArrayBuffer; mimeType: string; extension: string }
  | { type: 'error'; message: string }
