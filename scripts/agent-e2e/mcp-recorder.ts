import { z } from 'zod'
import { jsonObjectSchema } from './json'
import { transcriptText } from './loop'
import type { ToolCall } from './types'

export interface McpRecorder {
  url: string
  since(mark: number): ToolCall[]
  mark(): number
  stop(): Promise<void>
}

const HOP_HEADERS = ['host', 'connection', 'content-length', 'accept-encoding']

const callRequest = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.literal('tools/call'),
  params: z.object({ name: z.string(), arguments: jsonObjectSchema.default({}) }),
})

const callResponse = z.object({
  id: z.union([z.string(), z.number()]),
  result: z
    .object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
      isError: z.boolean().default(false),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
})

interface Pending {
  record: ToolCall
  startedAt: number
}

function messagesOf(body: string, contentType: string): unknown[] {
  const payloads = contentType.includes('text/event-stream')
    ? body
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
    : [body]
  return payloads.flatMap((payload) => {
    try {
      const parsed: unknown = JSON.parse(payload)
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return []
    }
  })
}

function forwardHeaders(headers: Headers): Headers {
  const out = new Headers(headers)
  for (const name of HOP_HEADERS) out.delete(name)
  return out
}

export function startMcpRecorder(upstreamUrl: string): McpRecorder {
  const upstream = new URL(upstreamUrl)
  const calls: ToolCall[] = []
  const pending = new Map<string, Pending>()

  const settle = (message: unknown): void => {
    const response = callResponse.safeParse(message)
    if (!response.success) return
    const entry = pending.get(String(response.data.id))
    if (entry === undefined) return
    pending.delete(String(response.data.id))
    const { result, error } = response.data
    const text = error?.message ?? (result?.content ?? []).map((part) => part.text ?? '').join('\n')
    entry.record.result = transcriptText(text)
    entry.record.isError = error !== undefined || result?.isError === true
    entry.record.durationMs = Math.round(performance.now() - entry.startedAt)
  }

  const fail = (opened: string[], error: unknown): Response => {
    const message = `recording proxy lost the upstream response. ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
    for (const id of opened) {
      const entry = pending.get(id)
      if (entry === undefined) continue
      pending.delete(id)
      entry.record.result = message
      entry.record.durationMs = Math.round(performance.now() - entry.startedAt)
    }
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message } }, { status: 502 })
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    fetch: async (req) => {
      const target = new URL(upstream)
      const incoming = new URL(req.url)
      target.pathname = incoming.pathname
      for (const [key, value] of incoming.searchParams) target.searchParams.set(key, value)
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text()
      const opened: string[] = []
      if (body !== undefined) {
        for (const message of messagesOf(body, 'application/json')) {
          const call = callRequest.safeParse(message)
          if (!call.success) continue
          const record: ToolCall = { name: call.data.params.name, args: call.data.params.arguments, result: '', isError: true, durationMs: 0 }
          calls.push(record)
          pending.set(String(call.data.id), { record, startedAt: performance.now() })
          opened.push(String(call.data.id))
        }
      }
      const response = await fetch(target, { method: req.method, headers: forwardHeaders(req.headers), body }).catch((error: unknown) => fail(opened, error))
      const contentType = response.headers.get('content-type') ?? ''
      const headers = forwardHeaders(response.headers)
      if (req.method !== 'POST' || response.body === null) return new Response(response.body, { status: response.status, headers })
      const [client, tap] = response.body.tee()
      void new Response(tap)
        .text()
        .then((text) => messagesOf(text, contentType).forEach(settle))
        .catch((error: unknown) => fail(opened, error))
      return new Response(client, { status: response.status, headers })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}${upstream.pathname}`,
    mark: () => calls.length,
    since: (mark) => calls.slice(mark),
    stop: () => server.stop(true),
  }
}
