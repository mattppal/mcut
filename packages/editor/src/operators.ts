import { z } from 'zod'
import type { EditorEngine } from '@mcut/timeline'

export interface EditorOperatorContext {
  engine: EditorEngine
}

export type EnabledResult = boolean | { enabled: boolean; reason?: string }

export type OperatorCategory = 'playback' | 'selection' | 'clipboard' | 'edit' | 'track' | 'keyframes' | 'markers' | 'multicam' | 'media' | 'view'

export interface OperatorDefinition<Input = unknown, Output = unknown> {
  label: string
  description: string
  category: OperatorCategory
  inputSchema: z.ZodType<Input, unknown>
  enabled?(context: EditorOperatorContext, input: Input): EnabledResult
  run(context: EditorOperatorContext, input: Input): Output | Promise<Output>
}

export function defineOperator<Input, Output>(operator: OperatorDefinition<Input, Output>): OperatorDefinition<Input, Output> {
  return operator
}

export class OperatorError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OperatorError'
    this.code = code
  }
}

export function enabledStatus(operator: OperatorDefinition, context: EditorOperatorContext, input: unknown): { enabled: boolean; reason?: string } {
  try {
    const status = operator.enabled?.(context, input) ?? true
    if (typeof status === 'boolean') return { enabled: status }
    return status
  } catch (error) {
    return {
      enabled: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export const emptyInputSchema = z.object({})
