import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { startExportRequestSchema } from './export-protocol'
import { LiveMcutBridge } from './live-bridge'
import { createMcutMcpServerForTarget } from './server'

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  isError: z.boolean().optional(),
})

const startExportFrameSchema = z.object({ id: z.string(), type: z.literal('start_export'), payload: startExportRequestSchema })

const startedSchema = z.object({ jobId: z.string(), outputPath: z.string() })

const doneSchema = z.object({ state: z.literal('done'), outputPath: z.string(), bytes: z.number() })

function textOf(result: unknown): { isError: boolean; text: string } {
  const parsed = toolResultSchema.parse(result)
  return { isError: parsed.isError === true, text: parsed.content.map((part) => part.text).join('\n') }
}

describe('export jobs', () => {
  test('export_video runs one job at a time and get_export reports the file the upload wrote', async () => {
    const exportDir = await mkdtemp(join(tmpdir(), 'mcut-export-'))
    const bridge = new LiveMcutBridge({ token: 'test-token', requestTimeoutMs: 1000, exportDir })
    const port = await bridge.listen(0)
    const server = createMcutMcpServerForTarget({ target: bridge.createTarget() })
    const client = new Client({ name: 'test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=test-token`, { headers: { Origin: 'http://localhost:3000' } })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    let uploadUrl = ''
    socket.on('message', (raw) => {
      const request = startExportFrameSchema.safeParse(JSON.parse(raw.toString()))
      if (!request.success) return
      const { jobId } = request.data.payload
      uploadUrl = request.data.payload.uploadUrl
      socket.send(JSON.stringify({ type: 'export_progress', payload: { jobId, phase: 'video', progress: 0.5 } }))
      socket.send(JSON.stringify({ id: request.data.id, ok: true, result: { format: 'webm', filename: 'Demo.webm', durationMs: 2000 } }))
    })

    try {
      const started = textOf(await client.callTool({ name: 'export_video', arguments: {} }))
      expect(started.isError).toBe(false)
      const [, startedJson = ''] = started.text.split('Result:\n')
      const job = startedSchema.parse(JSON.parse(startedJson))
      expect(job.outputPath).toBe(join(exportDir, 'Demo.webm'))

      const second = textOf(await client.callTool({ name: 'export_video', arguments: { format: 'mp4' } }))
      expect(second).toEqual({
        isError: true,
        text: `Export ${job.jobId} is still running (50%). Call get_export { jobId } to wait for it, or cancel_export first.`,
      })

      const forged = await fetch(uploadUrl.replace('test-token', 'wrong-token'), { method: 'PUT', body: 'forged' })
      expect(forged.status).toBe(403)

      const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])
      const upload = await fetch(uploadUrl, { method: 'PUT', body: bytes })
      expect(await upload.json()).toEqual({ path: job.outputPath, bytes: bytes.length })

      const read = textOf(await client.callTool({ name: 'get_export', arguments: { jobId: job.jobId, waitMs: 1000 } }))
      expect(doneSchema.parse(JSON.parse(read.text))).toMatchObject({ outputPath: job.outputPath, bytes: bytes.length })
      expect(new Uint8Array(await readFile(job.outputPath))).toEqual(bytes)
    } finally {
      socket.close()
      await client.close()
      await server.close()
      bridge.close()
      await rm(exportDir, { recursive: true, force: true })
    }
  })
})
