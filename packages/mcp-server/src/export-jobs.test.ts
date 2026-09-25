import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, mock, test } from 'bun:test'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { holdReplacedClose, holdSocketCloses } from './export-socket-holds'
import { startExportRequestSchema } from './export-protocol'
import { LiveMcutBridge } from './live-bridge'
import { createMcutMcpServerForTarget } from './server'

interface Hold {
  entered: () => void
  released: Promise<void>
}

const mkdirHolds = new Map<string, Hold>()
const renameHolds = new Map<string, Hold>()

function held<T>(holds: Map<string, Hold>, key: fs.PathLike, run: () => Promise<T>): Promise<T> {
  const hold = holds.get(String(key))
  if (!hold) return run()
  hold.entered()
  return hold.released.then(run)
}

mock.module('node:fs/promises', () => {
  const real = fs.promises
  return {
    ...real,
    mkdir: (path: fs.PathLike, options?: fs.MakeDirectoryOptions) => held(mkdirHolds, path, () => real.mkdir(path, options)),
    rename: (from: fs.PathLike, to: fs.PathLike) => held(renameHolds, to, () => real.rename(from, to)),
  }
})

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  isError: z.boolean().optional(),
})

const startExportFrameSchema = z.object({ id: z.string(), type: z.literal('start_export'), payload: startExportRequestSchema })

const cancelExportFrameSchema = z.object({ id: z.string(), type: z.literal('cancel_export'), payload: z.object({ jobId: z.string() }) })

const startedSchema = z.object({ jobId: z.string(), outputPath: z.string() })

const doneSchema = z.object({ state: z.literal('done'), outputPath: z.string(), bytes: z.number() })

const viewSchema = z.object({
  jobId: z.string(),
  state: z.string(),
  percent: z.number().optional(),
  error: z.string().optional(),
  outputPath: z.string().optional(),
})

interface Studio {
  uploadUrl: string
  onCancel: ((send: () => void) => void) | null
}

interface Session {
  exportDir: string
  port: number
  client: Client
}

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function hold(map: Map<string, Hold>, key: string): { entered: Promise<void>; release: () => void } {
  const entered = defer()
  const released = defer()
  map.set(key, { entered: entered.resolve, released: released.promise })
  return { entered: entered.promise, release: released.resolve }
}

function textOf(result: unknown): { isError: boolean; text: string } {
  const parsed = toolResultSchema.parse(result)
  return { isError: parsed.isError === true, text: parsed.content.map((part) => part.text).join('\n') }
}

function jsonBody(text: string): unknown {
  const [, json] = text.split('Result:\n')
  return JSON.parse(json ?? text)
}

function openSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=test-token`, { headers: { Origin: 'http://localhost:3000' } })
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

const studioReply = { format: 'webm', filename: 'Demo.webm', durationMs: 2000 }

function delayStart(socket: WebSocket): { seen: Promise<void>; reply: () => void } {
  const seen = defer()
  let send = () => {}
  socket.on('message', (raw) => {
    const start = startExportFrameSchema.safeParse(JSON.parse(raw.toString()))
    if (!start.success) return
    send = () => {
      socket.send(JSON.stringify({ id: start.data.id, ok: true, result: studioReply }))
    }
    seen.resolve()
  })
  return { seen: seen.promise, reply: () => send() }
}

function bindStudio(socket: WebSocket, studio: Studio, progress: number | null): void {
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    const start = startExportFrameSchema.safeParse(message)
    if (start.success) {
      const { jobId, uploadUrl } = start.data.payload
      studio.uploadUrl = uploadUrl
      if (progress !== null) socket.send(JSON.stringify({ type: 'export_progress', payload: { jobId, phase: 'video', progress } }))
      socket.send(JSON.stringify({ id: start.data.id, ok: true, result: studioReply }))
      return
    }
    const cancel = cancelExportFrameSchema.safeParse(message)
    if (!cancel.success) return
    const send = () => socket.send(JSON.stringify({ id: cancel.data.id, ok: true, result: null }))
    if (studio.onCancel) studio.onCancel(send)
    else send()
  })
}

async function call(client: Client, name: string, args?: { format?: 'mp4'; jobId?: string; waitMs?: number }): Promise<{ isError: boolean; text: string }> {
  return textOf(await client.callTool({ name, arguments: args ?? {} }))
}

async function withSession(run: (session: Session) => Promise<void>): Promise<void> {
  const exportDir = await fs.promises.mkdtemp(join(tmpdir(), 'mcut-export-'))
  const bridge = new LiveMcutBridge({ token: 'test-token', requestTimeoutMs: 1000, exportDir })
  const port = await bridge.listen(0)
  const server = createMcutMcpServerForTarget({ target: bridge.createTarget() })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    await run({ exportDir, port, client })
  } finally {
    mkdirHolds.delete(exportDir)
    await client.close()
    await server.close()
    bridge.close()
    await fs.promises.rm(exportDir, { recursive: true, force: true })
  }
}

function closed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve) => {
    socket.once('close', () => resolve())
  })
}

describe('export jobs', () => {
  test('export_video runs one job at a time and get_export reports the file the upload wrote', async () => {
    await withSession(async ({ exportDir, port, client }) => {
      const socket = await openSocket(port)
      const studio: Studio = { uploadUrl: '', onCancel: null }
      bindStudio(socket, studio, 0.5)
      try {
        const started = textOf(await client.callTool({ name: 'export_video', arguments: {} }))
        expect(started.isError).toBe(false)
        const job = startedSchema.parse(jsonBody(started.text))
        expect(job.outputPath).toBe(join(exportDir, 'Demo.webm'))

        const second = await call(client, 'export_video', { format: 'mp4' })
        expect(second).toEqual({
          isError: true,
          text: `Export ${job.jobId} is still running (50%). Call get_export { jobId } to wait for it, or cancel_export first.`,
        })

        const forged = await fetch(studio.uploadUrl.replace('test-token', 'wrong-token'), { method: 'PUT', body: 'forged' })
        expect(forged.status).toBe(403)

        const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])
        const upload = await fetch(studio.uploadUrl, { method: 'PUT', body: bytes })
        expect(await upload.json()).toEqual({ path: job.outputPath, bytes: bytes.length })

        const read = await call(client, 'get_export', { jobId: job.jobId, waitMs: 1000 })
        expect(doneSchema.parse(JSON.parse(read.text))).toMatchObject({ outputPath: job.outputPath, bytes: bytes.length })
        expect(new Uint8Array(await fs.promises.readFile(job.outputPath))).toEqual(bytes)

        const late = await call(client, 'cancel_export', { jobId: job.jobId })
        expect(late).toEqual({ isError: true, text: `Export ${job.jobId} is already done.` })
        expect(fs.existsSync(job.outputPath)).toBe(true)
      } finally {
        socket.close()
      }
    })
  })

  test('a disconnect while export_video is choosing a path fails that job', async () => {
    await withSession(async ({ exportDir, port, client }) => {
      const gate = hold(mkdirHolds, exportDir)
      const socket = await openSocket(port)
      bindStudio(socket, { uploadUrl: '', onCancel: null }, null)
      const pending = call(client, 'export_video')
      try {
        await gate.entered
        socket.close()
        await closed(socket)
        await new Promise((resolve) => setTimeout(resolve, 50))
        gate.release()
        expect(await pending).toEqual({ isError: true, text: 'Studio disconnected during export.' })
        const failed = viewSchema.parse(jsonBody((await call(client, 'get_export')).text))
        expect(failed).toMatchObject({ state: 'failed', error: 'Studio disconnected during export.' })

        const next = await openSocket(port)
        bindStudio(next, { uploadUrl: '', onCancel: null }, null)
        try {
          expect((await call(client, 'export_video')).isError).toBe(false)
        } finally {
          next.close()
        }
      } finally {
        gate.release()
        socket.close()
      }
    })
  })

  test('cancel during the upload rename stays cancelled and removes the file', async () => {
    await withSession(async ({ port, client }) => {
      const socket = await openSocket(port)
      const studio: Studio = { uploadUrl: '', onCancel: null }
      bindStudio(socket, studio, null)
      try {
        const started = startedSchema.parse(jsonBody((await call(client, 'export_video')).text))
        const gate = hold(renameHolds, started.outputPath)
        const cancelSeen = defer()
        let releaseCancel = () => {}
        studio.onCancel = (send) => {
          releaseCancel = send
          cancelSeen.resolve()
        }
        const upload = fetch(studio.uploadUrl, { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]) })
        await gate.entered
        const canceling = call(client, 'cancel_export', { jobId: started.jobId })
        await cancelSeen.promise
        gate.release()
        const uploaded = await upload
        releaseCancel()
        const cancelled = await canceling
        expect(cancelled.isError).toBe(false)
        expect(viewSchema.parse(jsonBody(cancelled.text)).state).toBe('cancelled')
        expect(uploaded.status).toBe(409)
        expect(await uploaded.json()).toEqual({ ok: false, error: `Export ${started.jobId} stopped while writing.` })
        expect(fs.existsSync(started.outputPath)).toBe(false)
        expect(fs.existsSync(`${started.outputPath}.part`)).toBe(false)
        const after = viewSchema.parse(jsonBody((await call(client, 'get_export', { jobId: started.jobId })).text))
        expect(after.state).toBe('cancelled')
      } finally {
        socket.close()
      }
    })
  })

  test('a replaced tab closing late does not fail the export on the new tab', async () => {
    await withSession(async ({ port, client }) => {
      const closes = holdSocketCloses()
      let previous: WebSocket | undefined
      let current: WebSocket | undefined
      try {
        previous = await openSocket(port)
        current = await openSocket(port)
        bindStudio(current, { uploadUrl: '', onCancel: null }, 0.5)
        const started = startedSchema.parse(jsonBody((await call(client, 'export_video')).text))
        const rendering = viewSchema.parse(jsonBody((await call(client, 'get_export', { jobId: started.jobId })).text))
        expect(rendering).toMatchObject({ state: 'rendering', percent: 50 })
        closes.release()
        await new Promise((resolve) => setTimeout(resolve, 20))
        current.send(JSON.stringify({ type: 'export_progress', payload: { jobId: started.jobId, phase: 'finalize', progress: 0.8 } }))
        const deadline = Date.now() + 1000
        let later = viewSchema.parse(jsonBody((await call(client, 'get_export', { jobId: started.jobId })).text))
        while (Date.now() < deadline && later.state === 'rendering' && later.percent !== 80) {
          await new Promise((resolve) => setTimeout(resolve, 10))
          later = viewSchema.parse(jsonBody((await call(client, 'get_export', { jobId: started.jobId })).text))
        }
        expect(later).toMatchObject({ state: 'rendering', percent: 80 })
      } finally {
        closes.restore()
        current?.close()
        previous?.close()
      }
    })
  })

  test('a start_export reply that crosses a tab replacement does not stay rendering', async () => {
    const closes = holdReplacedClose()
    await withSession(async ({ port, client }) => {
      let first: WebSocket | undefined
      let next: WebSocket | undefined
      try {
        first = await openSocket(port)
        const delayed = delayStart(first)
        const pending = call(client, 'export_video')
        await delayed.seen
        next = await openSocket(port)
        bindStudio(next, { uploadUrl: '', onCancel: null }, null)
        delayed.reply()
        await pending
        closes.release()
        await new Promise((resolve) => setTimeout(resolve, 20))
        const view = viewSchema.parse(jsonBody((await call(client, 'get_export')).text))
        expect(view).toMatchObject({ state: 'failed', error: 'Studio disconnected during export.' })
        expect((await call(client, 'export_video')).isError).toBe(false)
      } finally {
        closes.restore()
        first?.close()
        next?.close()
      }
    })
  })

  test('an export_video sent while the current tab is closing finishes on the reconnected tab', async () => {
    await withSession(async ({ port, client }) => {
      const closes = holdSocketCloses()
      let closing: WebSocket | undefined
      let next: WebSocket | undefined
      const studio: Studio = { uploadUrl: '', onCancel: null }
      try {
        closing = await openSocket(port)
        closing.close()
        await closes.held
        const pending = call(client, 'export_video')
        await new Promise((resolve) => setTimeout(resolve, 20))
        closes.release()
        next = await openSocket(port)
        bindStudio(next, studio, null)
        const started = await pending
        expect({ error: started.isError, text: started.text }).toEqual({ error: false, text: started.text })
        const job = startedSchema.parse(jsonBody(started.text))
        const upload = await fetch(studio.uploadUrl, { method: 'PUT', body: new Uint8Array([9, 8, 7]) })
        expect(upload.status).toBe(200)
        const done = viewSchema.parse(jsonBody((await call(client, 'get_export', { jobId: job.jobId })).text))
        expect(done.state).toBe('done')
      } finally {
        closes.restore()
        closing?.close()
        next?.close()
      }
    })
  })

  test('cancel_export while starting tells export_video the job is cancelled', async () => {
    await withSession(async ({ port, client }) => {
      const socket = await openSocket(port)
      socket.on('message', (raw) => {
        const cancel = cancelExportFrameSchema.safeParse(JSON.parse(raw.toString()))
        if (!cancel.success) return
        socket.send(JSON.stringify({ id: cancel.data.id, ok: true, result: null }))
      })
      const delayed = delayStart(socket)
      try {
        const pending = call(client, 'export_video')
        await delayed.seen
        const cancel = await call(client, 'cancel_export')
        const cancelled = viewSchema.parse(jsonBody(cancel.text))
        expect(cancelled.state).toBe('cancelled')
        delayed.reply()
        expect(await pending).toEqual({ isError: true, text: `Export ${cancelled.jobId} is already cancelled.` })
      } finally {
        socket.close()
      }
    })
  })
})
