import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, parse } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { LiveBridgeError } from './bridge-error'
import {
  cancelExportInputSchema,
  exportFormatSchema,
  exportFrameSchema,
  exportVideoInputSchema,
  getExportInputSchema,
  startExportReplySchema,
  type ExportFormat,
  type ExportFrame,
  type ExportPhase,
  type ExportUploadReply,
} from './export-protocol'

export const EXPORTS_PATH = '/exports/'

const KEPT_JOBS = 10

const UNSAFE_FILENAME_CHARACTERS = /[<>:"/\\|?*]/g

interface ExportJobBase {
  jobId: string
  format: ExportFormat
  durationMs: number
  startedAt: number
  outputPath: string
}

type ExportJob = ExportJobBase &
  (
    | { state: 'rendering'; phase: ExportPhase; progress: number }
    | { state: 'writing'; renderMs: number }
    | { state: 'done'; bytes: number; renderMs: number; endedAt: number }
    | { state: 'failed'; message: string; progress: number; endedAt: number }
    | { state: 'cancelled'; progress: number; endedAt: number }
  )

type LiveExportJob = ExportJob & { state: 'rendering' | 'writing' }

export interface ExportJobsOptions {
  exportDir: string | undefined
  token: string | null
  allowOrigin: (origin: string | undefined) => boolean
  address: () => AddressInfo | string | null
  request: (type: string, payload: unknown) => Promise<unknown>
}

interface Upload {
  status: number
  body: ExportUploadReply
}

interface StartingJob {
  jobId: string
  frames: ExportFrame[]
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

function defaultExportDir(): string {
  const downloads = join(homedir(), 'Downloads')
  return isDirectory(downloads) ? downloads : tmpdir()
}

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input ?? {})
  if (parsed.success) return parsed.data
  throw new LiveBridgeError('invalid-input', z.prettifyError(parsed.error))
}

function checkOutputPath(path: string, format: ExportFormat | undefined): { path: string; format: ExportFormat | undefined } {
  if (!isAbsolute(path)) throw new LiveBridgeError('invalid-output-path', `outputPath must be absolute, got ${path}.`)
  if (!isDirectory(dirname(path))) throw new LiveBridgeError('invalid-output-path', `The folder ${dirname(path)} does not exist.`)
  if (isDirectory(path)) throw new LiveBridgeError('invalid-output-path', `${path} is a folder. Pass a file path inside it.`)
  const implied = exportFormatSchema.safeParse(extname(path).slice(1).toLowerCase())
  if (!implied.success) return { path, format }
  if (format !== undefined && format !== implied.data) {
    throw new LiveBridgeError('invalid-output-path', `outputPath ends in .${implied.data} but format is ${format}.`)
  }
  return { path, format: implied.data }
}

function safeFilename(filename: string, format: ExportFormat): string {
  const cleaned = filename.replace(UNSAFE_FILENAME_CHARACTERS, '_').trim()
  return cleaned === '' || cleaned.startsWith('.') ? `export.${format}` : cleaned
}

const baseOf = ({ jobId, format, durationMs, startedAt, outputPath }: ExportJobBase): ExportJobBase => ({ jobId, format, durationMs, startedAt, outputPath })

const isLive = (job: ExportJob | undefined): job is LiveExportJob => job?.state === 'rendering' || job?.state === 'writing'

const renderedFraction = (job: LiveExportJob): number => (job.state === 'rendering' ? job.progress : 1)

const percentOf = (progress: number): number => Math.round(progress * 100)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const rejected = (status: number, error: string): Upload => ({ status, body: { ok: false, error } })

const busy = (jobId: string, percent: number): LiveBridgeError =>
  new LiveBridgeError('export-busy', `Export ${jobId} is still running (${percent}%). Call get_export { jobId } to wait for it, or cancel_export first.`)

function reply(res: ServerResponse, { status, body }: Upload, headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(`${JSON.stringify(body)}\n`)
}

function exportView(job: ExportJob, now: number) {
  const common = { jobId: job.jobId, state: job.state, format: job.format, outputPath: job.outputPath }
  switch (job.state) {
    case 'rendering': {
      const elapsedMs = now - job.startedAt
      const eta = job.progress > 0 ? { etaMs: Math.round((elapsedMs * (1 - job.progress)) / job.progress) } : {}
      return { ...common, phase: job.phase, percent: percentOf(job.progress), elapsedMs, ...eta }
    }
    case 'writing':
      return { ...common, percent: 100, elapsedMs: now - job.startedAt }
    case 'done':
      return { ...common, percent: 100, elapsedMs: job.endedAt - job.startedAt, bytes: job.bytes, renderMs: job.renderMs }
    case 'failed':
      return { ...common, percent: percentOf(job.progress), elapsedMs: job.endedAt - job.startedAt, error: job.message }
    case 'cancelled':
      return { ...common, percent: percentOf(job.progress), elapsedMs: job.endedAt - job.startedAt }
    default: {
      const unhandled: never = job
      throw new LiveBridgeError('invalid-export', `Unknown export job ${JSON.stringify(unhandled)}.`)
    }
  }
}

export class ExportJobs {
  private readonly options: ExportJobsOptions
  private readonly exportDir: string
  private readonly jobs = new Map<string, ExportJob>()
  private readonly wakers = new Set<() => void>()
  private starting: StartingJob | null = null

  constructor(options: ExportJobsOptions) {
    this.options = options
    this.exportDir = options.exportDir ?? defaultExportDir()
  }

  async start(input: unknown) {
    const { format, outputPath } = parseInput(exportVideoInputSchema, input)
    this.assertIdle()
    const target = outputPath === undefined ? undefined : checkOutputPath(outputPath, format)
    const jobId = randomBytes(4).toString('hex')
    const startedAt = Date.now()
    const starting: StartingJob = { jobId, frames: [] }
    this.starting = starting
    try {
      const answer = await this.options.request('start_export', { jobId, format: target?.format ?? format, uploadUrl: this.uploadUrl(jobId) })
      const reply = startExportReplySchema.safeParse(answer)
      if (!reply.success) {
        throw new LiveBridgeError('invalid-reply', `Studio answered start_export with an unexpected reply. ${z.prettifyError(reply.error)}`)
      }
      const { format: chosen, filename, durationMs } = reply.data
      const path = target?.path ?? (await this.freePath(filename, chosen))
      this.add({ jobId, format: chosen, durationMs, startedAt, outputPath: path, state: 'rendering', phase: 'audio', progress: 0 })
      for (const frame of starting.frames) this.apply(frame)
      return { jobId, format: chosen, outputPath: path, durationMs }
    } finally {
      this.starting = null
    }
  }

  async get(input: unknown) {
    const { jobId, waitMs } = parseInput(getExportInputSchema, input)
    const job = this.find(jobId)
    if (waitMs !== undefined) await this.waitWhileLive(job.jobId, waitMs)
    return exportView(this.find(job.jobId), Date.now())
  }

  async cancel(input: unknown) {
    const { jobId } = parseInput(cancelExportInputSchema, input)
    const job = this.find(jobId)
    if (!isLive(job)) throw new LiveBridgeError('export-not-running', `Export ${job.jobId} is already ${job.state}.`)
    this.put({ ...baseOf(job), state: 'cancelled', progress: renderedFraction(job), endedAt: Date.now() })
    await this.options.request('cancel_export', { jobId: job.jobId })
    return exportView(this.find(job.jobId), Date.now())
  }

  receive(message: unknown): boolean {
    const frame = exportFrameSchema.safeParse(message)
    if (!frame.success) return false
    const starting = this.starting
    if (starting?.jobId === frame.data.payload.jobId) {
      starting.frames.push(frame.data)
      return true
    }
    this.apply(frame.data)
    return true
  }

  disconnect(): void {
    for (const job of this.jobs.values()) {
      if (job.state !== 'rendering') continue
      this.put({ ...baseOf(job), state: 'failed', message: 'Studio disconnected during export.', progress: job.progress, endedAt: Date.now() })
    }
  }

  async serveUpload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const origin = req.headers.origin
    if (!this.options.allowOrigin(origin)) {
      reply(res, rejected(403, 'This origin may not upload exports.'))
      return
    }
    const cors: OutgoingHttpHeaders = origin === undefined ? {} : { 'access-control-allow-origin': origin, vary: 'origin' }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'PUT', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' })
      res.end()
      return
    }
    const upload = await this.receiveUpload(req, url).catch((error: unknown) => rejected(500, messageOf(error)))
    reply(res, upload, cors)
  }

  private async receiveUpload(req: IncomingMessage, url: URL): Promise<Upload> {
    if (req.method !== 'PUT') return rejected(405, 'Upload an export with PUT.')
    if (this.options.token !== null && url.searchParams.get('token') !== this.options.token) return rejected(403, 'Export uploads require the bridge token.')
    const jobId = url.pathname.slice(EXPORTS_PATH.length)
    const job = this.jobs.get(jobId)
    if (!job) return rejected(404, `No export ${jobId}.`)
    if (job.state !== 'rendering') return rejected(409, `Export ${jobId} is ${job.state}.`)
    const renderMs = Date.now() - job.startedAt
    const part = `${job.outputPath}.part`
    this.put({ ...baseOf(job), state: 'writing', renderMs })
    try {
      await pipeline(req, createWriteStream(part))
      const { size } = await stat(part)
      if (this.jobs.get(jobId)?.state !== 'writing') {
        await rm(part, { force: true })
        return rejected(409, `Export ${jobId} stopped while writing.`)
      }
      await rename(part, job.outputPath)
      this.put({ ...baseOf(job), state: 'done', bytes: size, renderMs, endedAt: Date.now() })
      return { status: 200, body: { path: job.outputPath, bytes: size } }
    } catch (error) {
      const message = `Writing ${job.outputPath} failed. ${messageOf(error)}`
      if (this.jobs.get(jobId)?.state === 'writing') this.put({ ...baseOf(job), state: 'failed', message, progress: 1, endedAt: Date.now() })
      await rm(part, { force: true })
      return rejected(500, message)
    }
  }

  private apply(frame: ExportFrame): void {
    const job = this.jobs.get(frame.payload.jobId)
    if (job?.state !== 'rendering') return
    switch (frame.type) {
      case 'export_progress':
        this.put({ ...baseOf(job), state: 'rendering', phase: frame.payload.phase, progress: frame.payload.progress })
        return
      case 'export_failed':
        this.put(
          frame.payload.cancelled
            ? { ...baseOf(job), state: 'cancelled', progress: job.progress, endedAt: Date.now() }
            : { ...baseOf(job), state: 'failed', message: frame.payload.message, progress: job.progress, endedAt: Date.now() },
        )
        return
      default: {
        const unhandled: never = frame
        throw new LiveBridgeError('invalid-frame', `Unknown export frame ${JSON.stringify(unhandled)}.`)
      }
    }
  }

  private assertIdle(): void {
    const live = [...this.jobs.values()].find(isLive)
    if (live) throw busy(live.jobId, percentOf(renderedFraction(live)))
    if (this.starting) throw busy(this.starting.jobId, 0)
  }

  private find(jobId: string | undefined): ExportJob {
    const job = jobId === undefined ? [...this.jobs.values()].at(-1) : this.jobs.get(jobId)
    if (job) return job
    if (jobId === undefined) throw new LiveBridgeError('export-not-found', 'No export has started. Call export_video first.')
    throw new LiveBridgeError('export-not-found', `No export ${jobId}. The bridge keeps the last ${KEPT_JOBS} jobs.`)
  }

  private add(job: ExportJob): void {
    this.put(job)
    for (const jobId of this.jobs.keys()) {
      if (this.jobs.size <= KEPT_JOBS) return
      this.jobs.delete(jobId)
    }
  }

  private put(job: ExportJob): void {
    this.jobs.set(job.jobId, job)
    for (const wake of this.wakers) wake()
  }

  private async waitWhileLive(jobId: string, waitMs: number): Promise<void> {
    const deadline = Date.now() + waitMs
    while (isLive(this.jobs.get(jobId)) && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer)
          this.wakers.delete(wake)
          resolve()
        }
        const timer = setTimeout(wake, deadline - Date.now())
        this.wakers.add(wake)
      })
    }
  }

  private async freePath(filename: string, format: ExportFormat): Promise<string> {
    await mkdir(this.exportDir, { recursive: true })
    const { name, ext } = parse(safeFilename(filename, format))
    for (let copy = 1; ; copy += 1) {
      const path = join(this.exportDir, copy === 1 ? `${name}${ext}` : `${name} (${copy})${ext}`)
      if (!existsSync(path) && !existsSync(`${path}.part`)) return path
    }
  }

  private uploadUrl(jobId: string): string {
    const address = this.options.address()
    if (address === null || typeof address === 'string') throw new LiveBridgeError('invalid-listener', 'The live bridge is not listening.')
    const url = new URL(`${EXPORTS_PATH}${jobId}`, `http://127.0.0.1:${address.port}`)
    if (this.options.token !== null) url.searchParams.set('token', this.options.token)
    return url.href
  }
}
