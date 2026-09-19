import type { Project } from '@mcut/timeline'
import { loadMediaBlob } from './media-store'
import { runExportPipeline } from './export-core'
import type { ExportFontFaceInit, ExportWorkerRequest, ExportWorkerResponse } from './export-types'

interface ExportWorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null
  fonts?: FontFaceSet
}

const scope = globalThis as unknown as ExportWorkerScope

const post = (message: ExportWorkerResponse, transfer?: Transferable[]) =>
  transfer ? scope.postMessage(message, transfer) : scope.postMessage(message)

// A worker's FontFaceSet is separate from document.fonts, see https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/fonts
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

async function resolveAssets(project: Project): Promise<{ project: Project; revoke: () => void }> {
  const urls: string[] = []
  const assets = { ...project.assets }
  for (const [id, asset] of Object.entries(assets)) {
    if (!asset.hash) continue
    const blob = await loadMediaBlob(asset.hash)
    if (!blob) continue
    const src = URL.createObjectURL(blob)
    urls.push(src)
    assets[id] = { ...asset, src }
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
    const { project, revoke } = await resolveAssets(message.project)
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
