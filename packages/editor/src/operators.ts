import { z } from 'zod'
import type { EditorEngine } from '@mcut/timeline'

export interface EditorOperatorContext {
  engine: EditorEngine
}

export type EnabledResult = boolean | { enabled: boolean; reason?: string }

export type OperatorCategory =
  | 'playback'
  | 'selection'
  | 'clipboard'
  | 'edit'
  | 'track'
  | 'keyframes'
  | 'markers'
  | 'multicam'
  | 'media'
  | 'view'

export interface EditorOperator<Input = unknown, Output = unknown> {
  /** Stable id, e.g. "edit.splitSelectionAtPlayhead". */
  id: string
  label: string
  description: string
  category: OperatorCategory
  inputSchema: z.ZodType<Input, unknown>
  /**
   * Whether this operator applies in the current editor state. Returning a
   * reason lets agent transports explain why a user-level action is unavailable.
   */
  enabled?: (context: EditorOperatorContext, input: Input) => EnabledResult
  run: (context: EditorOperatorContext, input: Input) => Output | Promise<Output>
}

export interface ListedEditorOperator {
  id: string
  label: string
  description: string
  category: OperatorCategory
  enabled: boolean
  disabledReason?: string
  inputSchema: z.ZodType<unknown, unknown>
}

export class OperatorError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OperatorError'
    this.code = code
  }
}

export class EditorOperatorRegistry {
  private readonly registry = new Map<string, EditorOperator<unknown, unknown>>()

  define<Input, Output = unknown>(operator: EditorOperator<Input, Output>): EditorOperator<Input, Output> {
    if (this.registry.has(operator.id)) {
      throw new OperatorError('duplicate-operator', `operator "${operator.id}" is already registered`)
    }
    this.registry.set(operator.id, operator as EditorOperator<unknown, unknown>)
    return operator
  }

  get(id: string): EditorOperator<unknown, unknown> | undefined {
    return this.registry.get(id)
  }

  list(): EditorOperator<unknown, unknown>[] {
    return [...this.registry.values()]
  }

  listAvailable(context: EditorOperatorContext): ListedEditorOperator[] {
    return this.list().map((operator) => {
      const input = safeDefaultInput(operator.inputSchema)
      const status = input.success ? enabledStatus(operator, context, input.data) : { enabled: true }
      return {
        id: operator.id,
        label: operator.label,
        description: operator.description,
        category: operator.category,
        enabled: status.enabled,
        disabledReason: status.reason,
        inputSchema: operator.inputSchema,
      }
    })
  }

  isEnabled(id: string, context: EditorOperatorContext, input: unknown = {}): boolean {
    const operator = this.require(id)
    const parsed = parseInput(operator, input)
    return enabledStatus(operator, context, parsed).enabled
  }

  async run(id: string, context: EditorOperatorContext, input: unknown = {}): Promise<unknown> {
    const operator = this.require(id)
    const parsed = parseInput(operator, input)
    const status = enabledStatus(operator, context, parsed)
    if (!status.enabled) {
      throw new OperatorError(
        'operator-disabled',
        status.reason ? `operator "${id}" is disabled: ${status.reason}` : `operator "${id}" is disabled`,
      )
    }
    return operator.run(context, parsed)
  }

  private require(id: string): EditorOperator<unknown, unknown> {
    const operator = this.registry.get(id)
    if (!operator) throw new OperatorError('unknown-operator', `unknown operator "${id}"`)
    return operator
  }
}

export function createEditorOperatorRegistry(): EditorOperatorRegistry {
  return new EditorOperatorRegistry()
}

function parseInput(operator: EditorOperator<unknown, unknown>, input: unknown): unknown {
  const parsed = operator.inputSchema.safeParse(input)
  if (!parsed.success) {
    throw new OperatorError(
      'invalid-input',
      `invalid input for "${operator.id}": ${parsed.error.message}`,
      { cause: parsed.error },
    )
  }
  return parsed.data
}

function enabledStatus(
  operator: EditorOperator<unknown, unknown>,
  context: EditorOperatorContext,
  input: unknown,
): { enabled: boolean; reason?: string } {
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

function safeDefaultInput(schema: z.ZodType<unknown, unknown>): { success: true; data: unknown } | { success: false } {
  const parsed = schema.safeParse({})
  return parsed.success ? { success: true, data: parsed.data } : { success: false }
}

export const emptyInputSchema = z.object({})
