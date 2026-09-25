import { containerFormats, exportProject, getExportSupport, type ContainerFormatId, type ExportProgress } from '@mcut/media'
import { exportUploadReplySchema, type ExportFrame, type StartExportReply } from '@mcut/mcp-server/contract'
import { getProjectDurationMs, type EditorEngine, type Project } from '@mcut/timeline'
import { toast } from 'sonner'
import type { ExportRequest } from './bridge-request'
import { collectProjectFontExports, ensureProjectFontsLoaded } from './font-library'

const PROGRESS_INTERVAL_MS = 500

const renders = new Map<string, AbortController>()

interface ExportRender {
  socket: WebSocket
  project: Project
  jobId: string
  format: ContainerFormatId
  filename: string
  uploadUrl: string
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function send(socket: WebSocket, frame: ExportFrame): void {
  socket.send(JSON.stringify(frame))
}

async function encodableFormat(requested: ContainerFormatId | undefined): Promise<ContainerFormatId> {
  const candidates: ContainerFormatId[] = requested === undefined ? ['mp4', 'webm'] : [requested]
  for (const format of candidates) {
    if ((await getExportSupport(format)).video) return format
  }
  throw new Error(`This browser cannot encode ${candidates.join(' or ')} video with WebCodecs.`)
}

async function upload(uploadUrl: string, blob: Blob, signal: AbortSignal): Promise<string> {
  const response = await fetch(uploadUrl, { method: 'PUT', body: blob, signal })
  const reply = exportUploadReplySchema.parse(await response.json())
  if ('error' in reply) throw new Error(reply.error)
  return reply.path
}

async function render({ socket, project, jobId, format, filename, uploadUrl }: ExportRender): Promise<void> {
  const controller = new AbortController()
  const stop = () => controller.abort()
  renders.set(jobId, controller)
  socket.addEventListener('close', stop)
  toast.loading(`Exporting ${filename}…`, { id: jobId })
  let reportedAt = -Infinity
  const onProgress = ({ phase, progress }: ExportProgress) => {
    const now = performance.now()
    if (now - reportedAt < PROGRESS_INTERVAL_MS) return
    reportedAt = now
    send(socket, { type: 'export_progress', payload: { jobId, phase, progress } })
    toast.loading(`Exporting ${filename}… ${Math.round(progress * 100)}%`, { id: jobId })
  }
  try {
    await ensureProjectFontsLoaded(project)
    const fonts = await collectProjectFontExports(project)
    const { blob } = await exportProject(project, { format, fonts, onProgress, signal: controller.signal })
    toast.success(`Exported to ${await upload(uploadUrl, blob, controller.signal)}`, { id: jobId })
  } catch (error) {
    const cancelled = controller.signal.aborted
    send(socket, { type: 'export_failed', payload: { jobId, message: messageOf(error), cancelled } })
    if (cancelled) toast('Export cancelled', { id: jobId })
    else toast.error(`Export failed. ${messageOf(error)}`, { id: jobId })
  } finally {
    socket.removeEventListener('close', stop)
    renders.delete(jobId)
  }
}

async function startExport(socket: WebSocket, engine: EditorEngine, request: Extract<ExportRequest, { type: 'start_export' }>): Promise<StartExportReply> {
  const { jobId, uploadUrl } = request.payload
  const project = engine.project
  const durationMs = getProjectDurationMs(project)
  if (durationMs <= 0) throw new Error('Place at least one clip on the timeline before exporting.')
  const format = await encodableFormat(request.payload.format)
  const filename = `${project.name || 'export'}.${containerFormats[format].extension}`
  engine.pause()
  void render({ socket, project, jobId, format, filename, uploadUrl })
  return { format, filename, durationMs }
}

export async function handleExportRequest(socket: WebSocket, engine: EditorEngine, request: ExportRequest): Promise<unknown> {
  switch (request.type) {
    case 'start_export':
      return await startExport(socket, engine, request)
    case 'cancel_export':
      renders.get(request.payload.jobId)?.abort()
      return null
    default: {
      const unhandled: never = request
      throw new Error(`Unknown export request ${JSON.stringify(unhandled)}.`)
    }
  }
}
