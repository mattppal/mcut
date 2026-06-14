import type { Project } from '@mcut/timeline'
import { loadMediaBlob } from './media-store'
import { runExportPipeline } from './export-core'
import type { ExportFontFaceInit, ExportWorkerRequest, ExportWorkerResponse } from './export-types'

/**
 * Dedicated export worker: receives the project (audio pre-mixed on the main
 * thread, where `OfflineAudioContext` lives) and runs the full decode→
 * composite→encode→mux pipeline off the main thread. The editor stays
 * responsive during export, and an export crash can't take down the tab.
 *
 * Abort is handled by termination from the client — no in-band protocol.
 */

/** Minimal worker-scope surface — keeps the package on the dom lib only. */
interface ExportWorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null
  fonts?: FontFaceSet
}

const scope = globalThis as unknown as ExportWorkerScope

const post = (message: ExportWorkerResponse, transfer?: Transferable[]) =>
  transfer ? scope.postMessage(message, transfer) : scope.postMessage(message)

/**
 * Workers have their own `FontFaceSet` — faces loaded into `document.fonts`
 * on the main thread are invisible here, and canvas text silently falls back
 * without them. Best-effort: a face that fails to load degrades to the
 * fallback font exactly like the main-thread renderer does.
 */
async function registerFonts(fonts: ExportFontFaceInit[]): Promise<void> {
  const fontSet = scope.fonts
  if (!fontSet || typeof FontFace === 'undefined') return
  await Promise.allSettled(
    fonts.map(async (init) => {
      const source = typeof init.source === 'string' ? `url(${JSON.stringify(init.source)})` : init.source
      const face = new FontFace(init.family, source, {
        ...(init.weight ? { weight: init.weight } : {}),
        ...(init.style ? { style: init.style } : {}),
        ...(init.unicodeRange ? { unicodeRange: init.unicodeRange } : {}),
      })
      await face.load()
      fontSet.add(face)
    }),
  )
}

/**
 * Re-bind asset srcs for this worker: main-thread blob URLs are fetchable
 * from a worker, but OPFS by content hash is both faster and immune to a
 * revoked URL — prefer it when the asset carries a hash.
 */
async function resolveAssets(project: Project): Promise<{ project: Project; revoke: () => void }> {
  const urls: string[] = []
  const assets = { ...project.assets }
  for (const [id, asset] of Object.entries(assets)) {
    if (!asset.hash) continue
    const blob = await loadMediaBlob(asset.hash).catch(() => null)
    if (!blob) continue
    const src = URL.createObjectURL(blob)
    urls.push(src)
    assets[id as keyof typeof assets] = { ...asset, src }
  }
  return {
    project: { ...project, assets },
    revoke: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  }
}

scope.onmessage = async (event: MessageEvent<ExportWorkerRequest>) => {
  const message = event.data
  if (message.type !== 'start') return
  try {
    await registerFonts(message.fonts)
    const { project, revoke } = await resolveAssets(message.project as Project)
    try {
      const result = await runExportPipeline(project, {
        ...(message.options.format ? { format: message.options.format } : {}),
        ...(message.options.videoBitrate !== undefined
          ? { videoBitrate: message.options.videoBitrate }
          : {}),
        mixedAudio: message.mixedAudio,
        onProgress: ({ progress, phase }) => post({ type: 'progress', progress, phase }),
      })
      post(
        { type: 'done', buffer: result.buffer, mimeType: result.mimeType, extension: result.extension },
        [result.buffer],
      )
    } finally {
      revoke()
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

post({ type: 'ready' })
