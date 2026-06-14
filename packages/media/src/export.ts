import { getProjectDurationMs, type Project } from '@mcut/timeline'
import { mixProjectAudio } from './export-audio'
import { getExportSupport, resolveContainerFormat, runExportPipeline } from './export-core'
import type {
  ExportFontFaceInit,
  ExportProjectOptions,
  ExportResult,
  ExportWorkerResponse,
  ExportWorkerStartMessage,
  MixedAudioData,
} from './export-types'

export { getExportSupport }
export type {
  ContainerFormatId,
  ExportFontFaceInit,
  ExportProgress,
  ExportProjectOptions,
  ExportResult,
} from './export-types'

/** How the last `exportProject` call ran — observability for tests/debugging. */
function noteExportMode(mode: 'worker' | 'local'): void {
  ;(globalThis as Record<string, unknown>).__mcutLastExportMode = mode
}

/** Worker spawn → first message budget (dev bundlers compile on demand). */
const WORKER_READY_TIMEOUT_MS = 15_000

/** The worker failed before its 'ready' handshake — safe to run locally. */
class WorkerStartError extends Error {}

/**
 * Render a project to a video file, fully client-side and deterministically.
 *
 * The audio mix renders first on the main thread (`OfflineAudioContext` and
 * the time-stretch worklet don't exist in workers), then the frame
 * decode→composite→encode→mux pipeline runs in a dedicated worker so the
 * editor stays responsive; environments without workers (Node/Bun, spawn
 * failure) fall back to running the same pipeline in-context.
 */
export async function exportProject(
  project: Project,
  options: ExportProjectOptions = {},
): Promise<ExportResult> {
  const { onProgress, signal } = options
  signal?.throwIfAborted()
  const durationMs = getProjectDurationMs(project)
  if (durationMs <= 0) throw new Error('Cannot export an empty project')
  const container = resolveContainerFormat(options.format) // fail fast on unknown ids

  // ---- audio mix (main thread) ---------------------------------------------
  let mixedAudio: MixedAudioData | null = null
  const support = await getExportSupport(options.format)
  if (support.audio) {
    onProgress?.({ phase: 'audio', progress: 0 })
    mixedAudio = await mixProjectAudio(project, durationMs, signal)
    onProgress?.({ phase: 'audio', progress: 0.1 })
  }

  // Quality objects don't survive structured clone — those exports run local.
  const serializableBitrate =
    options.videoBitrate === undefined || typeof options.videoBitrate === 'number'
  const worker = serializableBitrate ? spawnExportWorker() : null

  if (worker) {
    try {
      noteExportMode('worker')
      return await runInWorker(worker, project, options, mixedAudio, container.extension)
    } catch (error) {
      // The worker never came up (bundler missed the entry, script blocked):
      // nothing was transferred yet, so the same pipeline can run in-context.
      // Failures after startup are real export errors and propagate.
      if (!(error instanceof WorkerStartError)) throw error
      console.warn(`mcut export: ${error.message}; falling back to main-thread export`)
    } finally {
      worker.terminate()
    }
  }

  noteExportMode('local')
  const result = await runExportPipeline(project, {
    ...(options.format ? { format: options.format } : {}),
    ...(options.videoBitrate !== undefined ? { videoBitrate: options.videoBitrate } : {}),
    mixedAudio,
    ...(onProgress ? { onProgress } : {}),
    ...(signal ? { signal } : {}),
  })
  return { blob: new Blob([result.buffer], { type: result.mimeType }), extension: result.extension }
}

/**
 * Spawn the export worker, or null where workers can't run the pipeline
 * (Node/Bun, no Worker global, spawn throws). The `new Worker(new URL(...))`
 * form is load-bearing: bundlers (Turbopack/webpack/Vite) statically detect
 * it and emit `export-worker.js` as a worker entry.
 */
function spawnExportWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return null
  try {
    return new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
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

    // A worker that never says 'ready' (bundler misconfiguration, blocked
    // script) must not hang the export forever.
    const readyTimer = setTimeout(
      () => settle(() => reject(new WorkerStartError('export worker did not start in time'))),
      WORKER_READY_TIMEOUT_MS,
    )

    worker.onerror = (event) =>
      settle(() => {
        const detail = event.message || 'unknown error'
        // Pre-handshake failures (script 404, CSP) leave the transferable
        // inputs intact — the caller can rerun the pipeline locally.
        reject(
          started
            ? new Error(`Export worker crashed: ${detail}`)
            : new WorkerStartError(`export worker failed to load (${detail})`),
        )
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
              ...(typeof options.videoBitrate === 'number'
                ? { videoBitrate: options.videoBitrate }
                : {}),
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

function collectTransfers(
  mixedAudio: MixedAudioData | null,
  fonts: ExportFontFaceInit[] | undefined,
): Transferable[] {
  const transfers = new Set<Transferable>()
  if (mixedAudio) {
    transfers.add(mixedAudio.left.buffer as ArrayBuffer)
    transfers.add(mixedAudio.right.buffer as ArrayBuffer)
  }
  for (const font of fonts ?? []) {
    if (typeof font.source !== 'string') transfers.add(font.source)
  }
  return [...transfers]
}
