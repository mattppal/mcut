import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { LiveBridgeError } from './bridge-error'
import { checkOutputPath, defaultExportDir, freeExportPath } from './export-paths'
import {
  cancelExportInputSchema,
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

const DISCONNECTED = 'Studio disconnected during export.'

interface ExportJobBase {
  jobId: string
  format: ExportFormat
  durationMs: number
  startedAt: number
  outputPath: string
}

interface OpenIdentity {
  jobId: string
  startedAt: number
  format: ExportFormat | null
  durationMs: number | null
  outputPath: string | null
}

type StartingJob = OpenIdentity & { state: 'starting'; owner: object | null; frames: ExportFrame[] }

type RenderingJob = ExportJobBase & { state: 'rendering'; owner: object | null; phase: ExportPhase; progress: number }

type WritingJob = ExportJobBase & { state: 'writing'; renderMs: number }

type DoneJob = ExportJobBase & { state: 'done'; bytes: number; renderMs: number; endedAt: number }

type FailedJob = OpenIdentity & { state: 'failed'; message: string; progress: number; endedAt: number }

type CancelledJob = OpenIdentity & { state: 'cancelled'; progress: number; endedAt: number }

type ExportJob = StartingJob | RenderingJob | WritingJob | DoneJob | FailedJob | CancelledJob

type LiveExportJob = StartingJob | RenderingJob | WritingJob

export interface ExportJobsOptions {
  exportDir: string | undefined
  token: string | null
  allowOrigin: (origin: string | undefined) => boolean
  address: () => AddressInfo | string | null
  request: (type: string, payload: unknown) => Promise<unknown>
  socket: () => object | null
}

interface Upload {
  status: number
  body: ExportUploadReply
}

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input ?? {})
  if (parsed.success) return parsed.data
  throw new LiveBridgeError('invalid-input', z.prettifyError(parsed.error))
}

const baseOf = ({ jobId, format, durationMs, startedAt, outputPath }: ExportJobBase): ExportJobBase => ({ jobId, format, durationMs, startedAt, outputPath })

const isLive = (job: ExportJob | undefined): job is LiveExportJob => job?.state === 'starting' || job?.state === 'rendering' || job?.state === 'writing'

function livePercent(job: LiveExportJob): number {
  switch (job.state) {
    case 'starting':
      return 0
    case 'rendering':
      return percentOf(job.progress)
    case 'writing':
      return 100
    default: {
      const unhandled: never = job
      throw new LiveBridgeError('invalid-export', `Unknown export job ${JSON.stringify(unhandled)}.`)
    }
  }
}

function labeled(job: ExportJob) {
  return {
    jobId: job.jobId,
    state: job.state,
    ...(job.format === null ? {} : { format: job.format }),
    ...(job.outputPath === null ? {} : { outputPath: job.outputPath }),
  }
}

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
  const common = labeled(job)
  switch (job.state) {
    case 'starting':
      return { ...common, percent: 0, elapsedMs: now - job.startedAt }
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
    this.add({
      state: 'starting',
      jobId,
      startedAt,
      owner: this.options.socket(),
      frames: [],
      format: target?.format ?? format ?? null,
      durationMs: null,
      outputPath: target?.path ?? null,
    })
    try {
      const answer = await this.options.request('start_export', { jobId, format: target?.format ?? format, uploadUrl: this.uploadUrl(jobId) })
      const parsed = startExportReplySchema.safeParse(answer)
      if (!parsed.success) {
        throw new LiveBridgeError('invalid-reply', `Studio answered start_export with an unexpected reply. ${z.prettifyError(parsed.error)}`)
      }
      this.noteStart(jobId, parsed.data.format, parsed.data.durationMs)
      const path = target?.path ?? (await freeExportPath(this.exportDir, parsed.data.filename, parsed.data.format))
      return this.beginRendering(jobId, path, parsed.data.format, parsed.data.durationMs)
    } catch (error) {
      this.failIfStarting(jobId, messageOf(error))
      throw error
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
    const progress = job.state === 'rendering' ? job.progress : job.state === 'writing' ? 1 : 0
    this.put({
      state: 'cancelled',
      jobId: job.jobId,
      startedAt: job.startedAt,
      endedAt: Date.now(),
      progress,
      format: job.format,
      durationMs: job.durationMs,
      outputPath: job.outputPath,
    })
    await this.options.request('cancel_export', { jobId: job.jobId })
    return exportView(this.find(job.jobId), Date.now())
  }

  receive(message: unknown): boolean {
    const frame = exportFrameSchema.safeParse(message)
    if (!frame.success) return false
    const job = this.jobs.get(frame.data.payload.jobId)
    if (job?.state === 'starting') {
      job.frames.push(frame.data)
      return true
    }
    this.apply(frame.data)
    return true
  }

  disconnect(socket: object, current: boolean): void {
    for (const job of this.jobs.values()) {
      if (job.state !== 'starting' && job.state !== 'rendering') continue
      if (job.owner !== socket && !(job.owner === null && current)) continue
      this.failLive(job, DISCONNECTED)
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
      if (this.jobs.get(jobId)?.state !== 'writing') {
        await rm(job.outputPath, { force: true })
        await rm(part, { force: true })
        return rejected(409, `Export ${jobId} stopped while writing.`)
      }
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
        this.put({ ...baseOf(job), owner: job.owner, state: 'rendering', phase: frame.payload.phase, progress: frame.payload.progress })
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

  private noteStart(jobId: string, format: ExportFormat, durationMs: number): void {
    const job = this.jobs.get(jobId)
    if (job?.state !== 'starting') return
    this.put({ ...job, format, durationMs, owner: this.options.socket() ?? job.owner })
  }

  private beginRendering(jobId: string, outputPath: string, format: ExportFormat, durationMs: number) {
    const job = this.jobs.get(jobId)
    if (job?.state !== 'starting') throw new LiveBridgeError('browser-disconnected', DISCONNECTED)
    this.put({ jobId, format, durationMs, startedAt: job.startedAt, outputPath, owner: job.owner, state: 'rendering', phase: 'audio', progress: 0 })
    for (const frame of job.frames) this.apply(frame)
    return { jobId, format, outputPath, durationMs }
  }

  private failIfStarting(jobId: string, message: string): void {
    const job = this.jobs.get(jobId)
    if (job?.state !== 'starting') return
    this.failLive(job, message)
  }

  private failLive(job: StartingJob | RenderingJob, message: string): void {
    this.put({
      state: 'failed',
      jobId: job.jobId,
      startedAt: job.startedAt,
      endedAt: Date.now(),
      message,
      progress: job.state === 'rendering' ? job.progress : 0,
      format: job.format,
      durationMs: job.durationMs,
      outputPath: job.outputPath,
    })
  }

  private assertIdle(): void {
    for (const job of this.jobs.values()) {
      if (!isLive(job)) continue
      throw busy(job.jobId, livePercent(job))
    }
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

  private uploadUrl(jobId: string): string {
    const address = this.options.address()
    if (address === null || typeof address === 'string') throw new LiveBridgeError('invalid-listener', 'The live bridge is not listening.')
    const url = new URL(`${EXPORTS_PATH}${jobId}`, `http://127.0.0.1:${address.port}`)
    if (this.options.token !== null) url.searchParams.set('token', this.options.token)
    return url.href
  }
}
