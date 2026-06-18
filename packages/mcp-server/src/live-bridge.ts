import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocket, WebSocketServer, type VerifyClientCallbackSync } from 'ws'
import type { McutMcpTarget } from './server'

export const DEFAULT_BRIDGE_PORT = 44737

export interface LiveBridgeOptions {
  token?: string | null
  allowedOrigins?: string[]
  requestTimeoutMs?: number
  transcriptionTimeoutMs?: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface LiveBridgeMessage {
  id?: string
  type?: string
  payload?: unknown
  ok?: boolean
  result?: unknown
  error?: { name?: string; code?: string; message?: string }
}

export class LiveBridgeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LiveBridgeError'
    this.code = code
  }
}

function parsePort(value: string | null): number | null {
  if (!value) return null
  const port = Number(value)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin) return true
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (allowedOrigins.includes(origin)) return true
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
}

function tokenFrom(req: IncomingMessage): string | null {
  const host = req.headers.host ?? '127.0.0.1'
  const url = new URL(req.url ?? '/', `http://${host}`)
  return url.searchParams.get('token')
}

function hasCliHeader(req: IncomingMessage): boolean {
  return req.headers['x-mcut-bridge-client'] === 'cli'
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(`${JSON.stringify(value)}\n`)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function messageError(error: { name?: string; code?: string; message?: string }): Error {
  const prefix = error.code ? `${error.name ?? 'Error'} (${error.code})` : (error.name ?? 'Error')
  return new LiveBridgeError(error.code ?? 'browser-error', `${prefix}: ${error.message ?? 'Unknown error'}`)
}

export class LiveMcutBridge {
  readonly token: string | null
  readonly requestTimeoutMs: number
  readonly transcriptionTimeoutMs: number

  private readonly server = createServer((req, res) => void this.handleHttp(req, res))
  private readonly wss: WebSocketServer
  private readonly pending = new Map<string, PendingRequest>()
  private socket: WebSocket | null = null
  private nextId = 1
  private tabInfo: unknown = null

  constructor(options: LiveBridgeOptions = {}) {
    this.token = options.token === undefined ? randomBytes(32).toString('hex') : options.token
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.transcriptionTimeoutMs = options.transcriptionTimeoutMs ?? 10 * 60_000
    const allowedOrigins = options.allowedOrigins ?? []
    const verifyClient: VerifyClientCallbackSync = ({ origin, req }) =>
      (this.token === null || tokenFrom(req) === this.token) && isAllowedOrigin(origin, allowedOrigins)
    this.wss = new WebSocketServer({
      server: this.server,
      path: '/mcut-mcp',
      verifyClient,
    })
    this.wss.on('connection', (socket) => this.attach(socket))
  }

  async listen(port = 0): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject)
        resolve()
      })
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new LiveBridgeError('invalid-listener', 'Could not determine live bridge port.')
    }
    return address.port
  }

  close(): void {
    this.socket?.close()
    this.wss.close()
    this.server.close()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new LiveBridgeError('bridge-closed', `Live bridge closed before response ${id}.`))
    }
    this.pending.clear()
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  getTabInfo(): unknown {
    return this.tabInfo
  }

  async rpc(type: string, payload: unknown = {}): Promise<unknown> {
    switch (type) {
      case 'status':
        return {
          connected: this.isConnected(),
          tab: this.tabInfo,
        }
      default:
        return await this.request(type, payload)
    }
  }

  async request(type: string, payload: unknown = {}): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new LiveBridgeError(
        'browser-not-connected',
        'No mcut editor tab is connected. Open the live editor URL printed by the MCP server.',
      )
    }

    const timeoutMs = type === 'ensure_transcript' ? this.transcriptionTimeoutMs : this.requestTimeoutMs
    const id = String(this.nextId++)
    const body = JSON.stringify({ id, type, payload })
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new LiveBridgeError('request-timeout', `Timed out waiting for browser response to ${type}.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(body, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  createTarget(): McutMcpTarget {
    return {
      getSummary: async () => String(await this.request('get_summary')),
      getProject: () => this.request('get_project'),
      getMediaContext: () => this.request('get_media_context'),
      getTranscript: (options) => this.request('get_transcript', options ?? {}),
      searchTranscript: (query) => this.request('search_transcript', { query }),
      ensureTranscript: (input) => this.request('ensure_transcript', input ?? {}),
      getAudioActivity: (input) => this.request('get_audio_activity', input ?? {}),
      listActions: () => this.request('list_actions'),
      listOperators: () => this.request('list_operators'),
      undo: async () => Boolean(await this.request('undo')),
      redo: async () => Boolean(await this.request('redo')),
      runAction: (actionId, input) =>
        this.request('run_action', { actionId, input: input ?? {} }),
      runOperator: (operatorId, input) =>
        this.request('run_operator', { operatorId, input: input ?? {} }),
      dispatchCommand: (commandName, input) =>
        this.request('dispatch_command', { commandName, input: input ?? {} }),
    }
  }

  private attach(socket: WebSocket): void {
    this.socket?.close(1012, 'Another mcut editor tab connected.')
    this.socket = socket
    this.tabInfo = null

    socket.on('message', (raw) => this.receive(raw.toString()))
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null
        this.tabInfo = null
      }
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.reject(
          new LiveBridgeError('browser-disconnected', `Browser disconnected before response ${id}.`),
        )
      }
      this.pending.clear()
    })
  }

  private receive(raw: string): void {
    let message: LiveBridgeMessage
    try {
      message = JSON.parse(raw) as LiveBridgeMessage
    } catch {
      return
    }

    if (!message.id && message.type === 'hello') {
      this.tabInfo = message.payload ?? null
      return
    }

    if (!message.id) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)

    if (message.ok === false) {
      pending.reject(messageError(message.error ?? {}))
      return
    }
    pending.resolve(message.result)
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET' && req.url === '/status') {
      sendJson(res, 200, { ok: true, result: await this.rpc('status') })
      return
    }

    if (req.method !== 'POST' || req.url !== '/rpc') {
      sendJson(res, 404, { ok: false, error: 'Not found.' })
      return
    }

    if (req.headers.origin || !hasCliHeader(req)) {
      sendJson(res, 403, { ok: false, error: 'Bridge RPC is only available to local CLI clients.' })
      return
    }

    try {
      const body = (await readJson(req)) as { type?: unknown; payload?: unknown }
      if (typeof body.type !== 'string') {
        sendJson(res, 400, { ok: false, error: 'RPC request requires a string type.' })
        return
      }
      const result = await this.rpc(body.type, body.payload ?? {})
      sendJson(res, 200, { ok: true, result })
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export function parseLiveBridgePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const port = parsePort(value)
  if (port === null) throw new LiveBridgeError('invalid-port', `Invalid port: ${value}`)
  return port
}

export function createHttpBridgeTarget(port = DEFAULT_BRIDGE_PORT): McutMcpTarget {
  const rpc = async (type: string, payload: unknown = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mcut-bridge-client': 'cli',
      },
      body: JSON.stringify({ type, payload }),
    })
    const json = (await response.json()) as { ok: boolean; result?: unknown; error?: string }
    if (!response.ok || !json.ok) {
      throw new LiveBridgeError('bridge-rpc-failed', json.error ?? `Bridge RPC failed (${response.status}).`)
    }
    return json.result
  }

  return {
    getSummary: async () => String(await rpc('get_summary')),
    getProject: () => rpc('get_project'),
    getMediaContext: () => rpc('get_media_context'),
    getTranscript: (options) => rpc('get_transcript', options ?? {}),
    searchTranscript: (query) => rpc('search_transcript', { query }),
    ensureTranscript: (input) => rpc('ensure_transcript', input ?? {}),
    getAudioActivity: (input) => rpc('get_audio_activity', input ?? {}),
    listActions: () => rpc('list_actions'),
    listOperators: () => rpc('list_operators'),
    undo: async () => Boolean(await rpc('undo')),
    redo: async () => Boolean(await rpc('redo')),
    runAction: (actionId, input) => rpc('run_action', { actionId, input: input ?? {} }),
    runOperator: (operatorId, input) => rpc('run_operator', { operatorId, input: input ?? {} }),
    dispatchCommand: (commandName, input) => rpc('dispatch_command', { commandName, input: input ?? {} }),
  }
}
