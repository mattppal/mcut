import { z } from 'zod'
import type { ToolDefinition } from './mcp'
import type { FunctionCall, FunctionOutput, ModelClient, ModelTurn, Prompt } from './model'

export const DEFAULT_XAI_MODEL = 'grok-4.6'

export const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1'

export interface XaiOptions {
  apiKey: string
  model: string
  baseUrl: string
  requestTimeoutMs: number
}

const functionCallItemSchema = z.object({
  type: z.literal('function_call'),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
})

const messageItemSchema = z.object({
  type: z.literal('message'),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
})

const otherItemSchema = z.object({ type: z.string() })

const responseSchema = z.object({
  id: z.string(),
  output: z.array(z.union([functionCallItemSchema, messageItemSchema, otherItemSchema])).default([]),
  usage: z
    .object({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
    })
    .default({ input_tokens: 0, output_tokens: 0 }),
})

type ResponseItem = z.infer<typeof responseSchema>['output'][number]

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000]

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function toFunctionTool(tool: ToolDefinition) {
  const parameters = Object.fromEntries(Object.entries(tool.inputSchema).filter(([key]) => key !== '$schema'))
  return {
    type: 'function',
    name: tool.name,
    description: tool.description.length > 0 ? tool.description : `mcut tool ${tool.name}`,
    parameters: { type: 'object', ...parameters },
  }
}

function collectCalls(items: ResponseItem[]): FunctionCall[] {
  const calls: FunctionCall[] = []
  for (const item of items) {
    if (item.type === 'function_call' && 'call_id' in item) {
      calls.push({ callId: item.call_id, name: item.name, arguments: item.arguments })
    }
  }
  return calls
}

function collectText(items: ResponseItem[]): string {
  const parts: string[] = []
  for (const item of items) {
    if (item.type === 'message' && 'content' in item) {
      for (const part of item.content) {
        if (typeof part.text === 'string') parts.push(part.text)
      }
    }
  }
  return parts.join('\n').trim()
}

async function postResponses(options: XaiOptions, body: unknown, retryDelaysMs: readonly number[]): Promise<unknown> {
  const url = `${options.baseUrl.replace(/\/$/, '')}/responses`
  let lastError = new Error('xAI request was not attempted.')
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.requestTimeoutMs),
      })
      if (response.ok) return await response.json()
      const detail = (await response.text()).slice(0, 600)
      lastError = new Error(`xAI responded ${response.status} for ${url}. ${detail}`)
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable) throw lastError
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (lastError.message.startsWith('xAI responded 4')) throw lastError
    }
    const delay = retryDelaysMs[attempt]
    if (delay !== undefined) await sleep(delay)
  }
  throw lastError
}

export function createXaiModel(options: XaiOptions, retryDelaysMs: readonly number[] = RETRY_DELAYS_MS): ModelClient {
  let previousResponseId: string | null = null
  let tools: ReturnType<typeof toFunctionTool>[] = []

  const request = async (input: unknown[]): Promise<ModelTurn> => {
    const body = {
      model: options.model,
      input,
      tools,
      parallel_tool_calls: true,
      ...(previousResponseId === null ? {} : { previous_response_id: previousResponseId }),
    }
    const parsed = responseSchema.parse(await postResponses(options, body, retryDelaysMs))
    previousResponseId = parsed.id
    return {
      calls: collectCalls(parsed.output),
      text: collectText(parsed.output),
      tokens: { input: parsed.usage.input_tokens, output: parsed.usage.output_tokens },
    }
  }

  return {
    model: options.model,
    start: (prompt: Prompt, definitions: ToolDefinition[]) => {
      previousResponseId = null
      tools = definitions.map(toFunctionTool)
      return request([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ])
    },
    continue: (outputs: FunctionOutput[]) =>
      request(
        outputs.map((entry) => ({
          type: 'function_call_output',
          call_id: entry.callId,
          output: entry.output,
        })),
      ),
  }
}
