import { afterEach, describe, expect, test } from 'bun:test'
import { jsonObjectSchema, type JsonObject } from './json'
import type { ToolDefinition } from './mcp'
import { createXaiModel } from './xai'

interface Recorded {
  headers: Headers
  body: JsonObject
}

interface FakeXai {
  baseUrl: string
  requests: Recorded[]
  stop(): void
}

type Reply = { status: number; body: unknown }

function fakeXai(replies: Reply[]): FakeXai {
  const requests: Recorded[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push({ headers: request.headers, body: jsonObjectSchema.parse(await request.json()) })
      const reply = replies.shift() ?? { status: 500, body: { error: 'no scripted reply left' } }
      return Response.json(reply.body, { status: reply.status })
    },
  })
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    stop: () => server.stop(true),
  }
}

const tools: ToolDefinition[] = [
  {
    name: 'splitElement',
    description: 'Split an element.',
    inputSchema: {
      type: 'object',
      properties: { elementId: { type: 'string' }, atMs: { type: 'integer' } },
      required: ['elementId', 'atMs'],
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    },
  },
  { name: 'get_summary', description: '', inputSchema: { type: 'object', properties: {} } },
]

const prompt = { system: 'You edit video.', user: 'Split e-clip at 1000 ms.' }

const callReply: Reply = {
  status: 200,
  body: {
    id: 'resp_1',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'function_call', call_id: 'call_1', name: 'splitElement', arguments: '{"elementId":"e-clip","atMs":1000}' },
    ],
    usage: { input_tokens: 120, output_tokens: 15 },
  },
}

const doneReply: Reply = {
  status: 200,
  body: {
    id: 'resp_2',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }],
    usage: { input_tokens: 140, output_tokens: 4 },
  },
}

const options = (baseUrl: string) => ({ apiKey: 'test-key', model: 'grok-test', baseUrl, requestTimeoutMs: 5_000 })

describe('xAI Responses API client', () => {
  let fake: FakeXai | undefined

  afterEach(() => {
    fake?.stop()
    fake = undefined
  })

  test('sends flat function tools and chains turns with previous_response_id', async () => {
    fake = fakeXai([callReply, doneReply])
    const model = createXaiModel(options(fake.baseUrl), [])

    const first = await model.start(prompt, tools)
    expect(first.calls).toEqual([{ callId: 'call_1', name: 'splitElement', arguments: '{"elementId":"e-clip","atMs":1000}' }])
    expect(first.text).toBe('')
    expect(first.tokens).toEqual({ input: 120, output: 15 })

    const second = await model.continue([{ callId: 'call_1', output: 'OK: splitElement applied.' }])
    expect(second.calls).toEqual([])
    expect(second.text).toBe('Done.')
    expect(second.tokens).toEqual({ input: 140, output: 4 })

    const [open, follow] = fake.requests
    expect(open?.headers.get('authorization')).toBe('Bearer test-key')
    expect(open?.body).toEqual({
      model: 'grok-test',
      input: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      tools: [
        {
          type: 'function',
          name: 'splitElement',
          description: 'Split an element.',
          parameters: {
            type: 'object',
            properties: { elementId: { type: 'string' }, atMs: { type: 'integer' } },
            required: ['elementId', 'atMs'],
          },
        },
        {
          type: 'function',
          name: 'get_summary',
          description: 'mcut tool get_summary',
          parameters: { type: 'object', properties: {} },
        },
      ],
      parallel_tool_calls: true,
    })
    expect(follow?.body.previous_response_id).toBe('resp_1')
    expect(follow?.body.input).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: 'OK: splitElement applied.' }])
    expect(follow?.body.tools).toEqual(open?.body.tools)
  })

  test('start resets the conversation chain', async () => {
    fake = fakeXai([doneReply, doneReply])
    const model = createXaiModel(options(fake.baseUrl), [])
    await model.start(prompt, tools)
    await model.start(prompt, tools)
    expect(fake.requests.map((entry) => entry.body.previous_response_id)).toEqual([undefined, undefined])
  })

  test('retries 429 and 5xx replies before succeeding', async () => {
    fake = fakeXai([{ status: 429, body: { error: 'slow down' } }, { status: 503, body: {} }, doneReply])
    const model = createXaiModel(options(fake.baseUrl), [0, 0])
    const turn = await model.start(prompt, tools)
    expect(turn.text).toBe('Done.')
    expect(fake.requests).toHaveLength(3)
  })

  test('fails fast on other 4xx replies', async () => {
    fake = fakeXai([{ status: 400, body: { error: 'tool splitElement has an invalid schema' } }])
    const model = createXaiModel(options(fake.baseUrl), [0, 0])
    await expect(model.start(prompt, tools)).rejects.toThrow(/xAI responded 400 .*invalid schema/)
    expect(fake.requests).toHaveLength(1)
  })

  test('gives up after the retry budget is spent', async () => {
    fake = fakeXai([
      { status: 500, body: {} },
      { status: 500, body: {} },
    ])
    const model = createXaiModel(options(fake.baseUrl), [0])
    await expect(model.start(prompt, tools)).rejects.toThrow(/xAI responded 500/)
    expect(fake.requests).toHaveLength(2)
  })
})
