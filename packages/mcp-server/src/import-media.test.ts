import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject } from '@mcut/timeline'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { importMediaBridgePayloadSchema, mediaImportReportSchema, type MediaImportReport } from './contract'
import { LiveMcutBridge } from './live-bridge'
import { createMcutMcpServer, createMcutMcpServerForTarget } from './server'

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
  isError: z.boolean().optional(),
})

const frameSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.unknown().optional(),
})

function toolText(result: unknown): { text: string; isError: boolean } {
  const parsed = toolResultSchema.parse(result)
  const first = parsed.content[0]
  if (first === undefined) throw new Error('tool result has no text')
  return { text: first.text, isError: parsed.isError === true }
}

function toolReport(result: unknown): { text: string; isError: boolean; report: MediaImportReport } {
  const base = toolText(result)
  const jsonStart = base.text.indexOf('{')
  if (jsonStart < 0) throw new Error(`tool result has no report JSON: ${base.text}`)
  return { ...base, report: mediaImportReportSchema.parse(JSON.parse(base.text.slice(jsonStart))) }
}

describe('import_media', () => {
  test('headless server rejects import_media because it has no Studio bridge', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const server = createMcutMcpServer({ engine })
    const client = new Client({ name: 'test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const result = toolText(await client.callTool({ name: 'import_media', arguments: { paths: ['/tmp/clip.mp4'] } }))
      expect(result.isError).toBe(true)
      expect(result.text).toBe('import_media requires the live bridge connected to Studio.')
    } finally {
      await client.close()
      await server.close()
    }
  })

  test('missing, directory, and relative paths fail, and a grant serves its bytes once', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mcut-import-'))
    const clipPath = path.join(root, 'clip.webm')
    const emptyPath = path.join(root, 'empty.mp4')
    const notesPath = path.join(root, 'notes.txt')
    const missing = path.join(root, 'missing.mp4')
    await writeFile(clipPath, 'webm-bytes')
    await writeFile(emptyPath, '')
    await writeFile(notesPath, 'hello')
    const folder = await mkdtemp(path.join(root, 'dir-'))
    const bridge = new LiveMcutBridge({
      token: 'import-token',
      requestTimeoutMs: 2000,
      importTimeoutMs: 2000,
      reconnectGraceMs: 200,
      allowedOrigins: ['app://studio'],
    })
    const port = await bridge.listen(0)
    const server = createMcutMcpServerForTarget({ target: bridge.createTarget() })
    const client = new Client({ name: 'test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    let grantUrl = ''
    try {
      const rejected = toolReport(await client.callTool({ name: 'import_media', arguments: { paths: ['clips/relative.mp4'] } }))
      expect(rejected.isError).toBe(true)
      expect(rejected.text.startsWith('Imported nothing.')).toBe(true)
      expect(rejected.report).toEqual({
        imported: [],
        failed: [{ path: 'clips/relative.mp4', error: 'import_media requires an absolute path, got "clips/relative.mp4".' }],
      })

      const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=import-token`, {
        headers: { Origin: 'http://localhost:3000' },
      })
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      let handlerError: unknown
      socket.on('message', (raw) => {
        void (async () => {
          let id = ''
          try {
            const frame = frameSchema.parse(JSON.parse(raw.toString()))
            id = frame.id
            if (frame.type !== 'import_media') {
              socket.send(JSON.stringify({ id: frame.id, ok: true, result: null }))
              return
            }
            const payload = importMediaBridgePayloadSchema.parse(frame.payload)
            const file = payload.files[0]
            if (file === undefined) throw new Error('expected one granted file')
            grantUrl = file.url
            const preflight = await fetch(file.url, { method: 'OPTIONS', headers: { Origin: 'app://studio' } })
            expect(preflight.status).toBe(204)
            expect(preflight.headers.get('access-control-allow-origin')).toBe('app://studio')
            const evil = await fetch(file.url, { headers: { Origin: 'https://evil.example' } })
            expect(evil.status).toBe(403)
            const badToken = await fetch(file.url.replace('token=import-token', 'token=nope'))
            expect(badToken.status).toBe(403)
            const unknown = await fetch(`http://127.0.0.1:${port}/media/${'ab'.repeat(16)}?token=import-token`)
            expect(unknown.status).toBe(404)
            const body = await fetch(file.url)
            expect(body.status).toBe(200)
            expect(body.headers.get('content-type')).toBe('video/webm')
            expect(body.headers.get('content-length')).toBe(String('webm-bytes'.length))
            expect(await body.text()).toBe('webm-bytes')
            socket.send(
              JSON.stringify({
                id: frame.id,
                ok: true,
                result: {
                  imported: [{ path: clipPath, assetId: 'a-clip', name: 'clip.webm', kind: 'video', durationMs: 1200, width: 320, height: 180 }],
                  failed: [],
                },
              }),
            )
          } catch (error) {
            handlerError = error
            socket.send(JSON.stringify({ id, ok: false, error: { message: error instanceof Error ? error.message : String(error) } }))
          }
        })()
      })

      const imported = toolReport(
        await client.callTool({
          name: 'import_media',
          arguments: { paths: [clipPath, missing, folder, 'clips/relative.mp4', emptyPath, notesPath] },
        }),
      )
      if (handlerError !== undefined) throw handlerError
      expect(imported.isError).toBe(false)
      expect(imported.text.startsWith('Imported 1 file. Place each asset with addElement or an operator.')).toBe(true)
      expect(imported.report).toEqual({
        imported: [{ path: clipPath, assetId: 'a-clip', name: 'clip.webm', kind: 'video', durationMs: 1200, width: 320, height: 180 }],
        failed: [
          { path: missing, error: `import_media could not find "${missing}".` },
          { path: folder, error: `import_media cannot import "${folder}" because it is a directory.` },
          { path: 'clips/relative.mp4', error: 'import_media requires an absolute path, got "clips/relative.mp4".' },
          { path: emptyPath, error: `import_media cannot import "${emptyPath}" because it is empty.` },
          { path: notesPath, error: `import_media does not recognize the extension of "${notesPath}".` },
        ],
      })
      expect(grantUrl.length).toBeGreaterThan(0)
      expect((await fetch(grantUrl)).status).toBe(404)
      socket.close()
    } finally {
      await client.close()
      await server.close()
      bridge.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
