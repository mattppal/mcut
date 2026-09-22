import { getProjectDurationMs, type Project } from '@mcut/timeline'
import { containerFormats } from './container-formats'
import { mixProjectAudio } from './export-audio'
import type {
  ContainerFormatId,
  ExportFontFaceInit,
  ExportProjectOptions,
  ExportResult,
  ExportWorkerResponse,
  ExportWorkerStartMessage,
  MixedAudioData,
} from './export-types'

export type { ContainerFormatId, ExportFontFaceInit, ExportProgress, ExportProjectOptions, ExportResult } from './export-types'

function noteExportMode(mode: 'worker' | 'local'): void {
  Reflect.set(globalThis, '__mcutLastExportMode', mode)
}

const WORKER_READY_TIMEOUT_MS = 15_000

export async function getExportSupport(format: ContainerFormatId = 'mp4'): Promise<{ video: boolean; audio: boolean }> {
  const core = await import('./export-core')
  return core.getExportSupport(format)
}

class WorkerStartError extends Error {}

export async function exportProject(project: Project, options: ExportProjectOptions = {}): Promise<ExportResult> {
  const { onProgress, signal } = options
  signal?.throwIfAborted()
  const durationMs = getProjectDurationMs(project)
  if (durationMs <= 0) throw new Error('Cannot export an empty project')
  const container = containerFormats[options.format ?? 'mp4']

  let mixedAudio: MixedAudioData | null = null
  const support = await getExportSupport(options.format)
  // OfflineAudioContext is exposed on Window only per https://webaudio.github.io/web-audio-api/#OfflineAudioContext so the mix renders before the worker starts
  if (support.audio) {
    onProgress?.({ phase: 'audio', progress: 0 })
    mixedAudio = await mixProjectAudio(project, durationMs, signal)
    onProgress?.({ phase: 'audio', progress: 0.1 })
  }

  const serializableBitrate = options.videoBitrate === undefined || typeof options.videoBitrate === 'number'
  let worker: Worker | null = null
  if (serializableBitrate) {
    try {
      worker = spawnExportWorker()
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }

  if (worker) {
    try {
      noteExportMode('worker')
      return await runInWorker(worker, project, options, mixedAudio, container.extension)
    } catch (error) {
      if (!(error instanceof WorkerStartError)) throw error
    } finally {
      worker.terminate()
    }
  }

  noteExportMode('local')
  const { runExportPipeline } = await import('./export-core')
  const result = await runExportPipeline(project, {
    ...(options.format ? { format: options.format } : {}),
    ...(options.videoBitrate !== undefined ? { videoBitrate: options.videoBitrate } : {}),
    mixedAudio,
    ...(onProgress ? { onProgress } : {}),
    ...(signal ? { signal } : {}),
  })
  return { blob: new Blob([result.buffer], { type: result.mimeType }), extension: result.extension }
}

function spawnExportWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return null
  return new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' })
}

function runInWorker(
  worker: Worker,
  project: Project,
  options: ExportProjectOptions,
  mixedAudio: MixedAudioData | null,
  extension: string,
): Promise<ExportResult> {
  const { onProgress, signal } = options
  return new Promise<ExportResult>((resolve, reject) => {
    let settled = false
    let started = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(readyTimer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => settle(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')))
    signal?.addEventListener('abort', onAbort)

    const readyTimer = setTimeout(() => settle(() => reject(new WorkerStartError('export worker did not start in time'))), WORKER_READY_TIMEOUT_MS)

    worker.onerror = (event) =>
      settle(() => {
        const detail = event.message || 'unknown error'
        reject(started ? new Error(`Export worker crashed: ${detail}`) : new WorkerStartError(`export worker failed to load (${detail})`))
      })
    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'ready': {
          clearTimeout(readyTimer)
          started = true
          const start: ExportWorkerStartMessage = {
            type: 'start',
            project,
            options: {
              ...(options.format ? { format: options.format } : {}),
              ...(typeof options.videoBitrate === 'number' ? { videoBitrate: options.videoBitrate } : {}),
            },
            mixedAudio,
            fonts: options.fonts ?? [],
          }
          worker.postMessage(start, collectTransfers(mixedAudio, options.fonts))
          break
        }
        case 'progress':
          if (!settled) onProgress?.({ progress: message.progress, phase: message.phase })
          break
        case 'done':
          settle(() => {
            onProgress?.({ phase: 'finalize', progress: 1 })
            resolve({
              blob: new Blob([message.buffer], { type: message.mimeType }),
              extension: message.extension || extension,
            })
          })
          break
        case 'error':
          settle(() => reject(new Error(message.message)))
          break
      }
    }
  })
}

function collectTransfers(mixedAudio: MixedAudioData | null, fonts: ExportFontFaceInit[] | undefined): Transferable[] {
  const transfers = new Set<Transferable>()
  if (mixedAudio) {
    transfers.add(mixedAudio.left.buffer)
    transfers.add(mixedAudio.right.buffer)
  }
  for (const font of fonts ?? []) {
    if (typeof font.source !== 'string') transfers.add(font.source)
  }
  return [...transfers]
}
