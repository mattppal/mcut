import type { JsonObject } from './json'
import type { ToolDefinition } from './mcp'

export interface FunctionCall {
  callId: string
  name: string
  arguments: string
}

export interface FunctionOutput {
  callId: string
  output: string
}

export interface TokenUsage {
  input: number
  output: number
}

export interface ModelTurn {
  calls: FunctionCall[]
  text: string
  tokens: TokenUsage
}

export interface Prompt {
  system: string
  user: string
}

export interface ModelClient {
  readonly model: string
  start(prompt: Prompt, tools: ToolDefinition[]): Promise<ModelTurn>
  continue(outputs: FunctionOutput[]): Promise<ModelTurn>
}

export interface ScriptedCall {
  name: string
  args: JsonObject
}

export const SCRIPTED_MODEL_ID = 'scripted-dry-run'

const noTokens = (): TokenUsage => ({ input: 0, output: 0 })

export function createScriptedModel(script: readonly ScriptedCall[]): ModelClient {
  let index = 0
  const next = (): ModelTurn => {
    const call = script[index]
    if (call === undefined) return { calls: [], text: 'Done.', tokens: noTokens() }
    index += 1
    return {
      calls: [{ callId: `scripted-${index}`, name: call.name, arguments: JSON.stringify(call.args) }],
      text: '',
      tokens: noTokens(),
    }
  }
  return {
    model: SCRIPTED_MODEL_ID,
    start: async () => next(),
    continue: async () => next(),
  }
}
