import type { Quality } from 'mediabunny'

export interface ExportProgress {
  /** 0–1 across the whole export. */
  progress: number
  phase: 'audio' | 'video' | 'finalize'
}

/** A registered container format id (built-ins: mp4, webm, mkv). */
export type ContainerFormatId = 'mp4' | 'webm' | 'mkv' | (string & {})

/**
 * A font face the export worker registers into its own `FontFaceSet` before
 * rendering: workers do not see `document.fonts`, so faces loaded on the
 * main thread are invisible to an `OffscreenCanvas` in a worker. `source` is
 * either the face's binary or a URL the worker can fetch.
 */
export interface ExportFontFaceInit {
  family: string
  /** CSS font-weight descriptor (e.g. "400", "100 900" for variable). */
  weight?: string
  /** CSS font-style descriptor (e.g. "italic"). */
  style?: string
  /** CSS unicode-range descriptor (Google Fonts ships per-subset faces). */
  unicodeRange?: string
  source: ArrayBuffer | string
}

export interface ExportProjectOptions {
  /** Container format id from the registry. Default `'mp4'`. */
  format?: ContainerFormatId
  /** Video bitrate in bits/s or a mediabunny `Quality`. Default `QUALITY_HIGH`. */
  videoBitrate?: number | Quality
  /**
   * Font faces for text/caption rendering inside the export worker. Without
   * them the worker draws text with system fallback faces (web fonts loaded
   * on the main thread don't exist in worker scope).
   */
  fonts?: ExportFontFaceInit[]
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  /** Suggested file extension from the format's registry entry. */
  extension: string
}

export const AUDIO_SAMPLE_RATE = 48_000

/** Planar stereo PCM, the transferable form of the main-thread audio mix. */
export interface MixedAudioData {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

/** Options that survive structured clone (mediabunny `Quality` does not). */
export interface WorkerExportOptions {
  format?: ContainerFormatId
  videoBitrate?: number
}

export interface ExportWorkerStartMessage {
  type: 'start'
  /** Plain serializable project data (engine projects already are). */
  project: unknown
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
