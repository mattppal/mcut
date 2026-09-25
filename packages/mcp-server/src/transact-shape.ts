import { EditorEngine } from '@mcut/timeline'
import { z } from 'zod'

const toolArgumentsSchema = z.record(z.string(), z.unknown()).default({})

export const commandBatchSchema = z
  .array(
    z.looseObject({
      type: z.string().describe('Timeline command type, e.g. splitElement, trimElement, addElement.'),
    }),
  )
  .min(1)

export const transactSubRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('dispatch_command'),
    commandName: z.string(),
    input: toolArgumentsSchema,
  }),
  z.strictObject({
    type: z.literal('run_operator'),
    operatorId: z.string(),
    input: toolArgumentsSchema,
  }),
  z.strictObject({
    type: z.literal('run_action'),
    actionId: z.string(),
    input: toolArgumentsSchema,
  }),
  z.strictObject({
    type: z.literal('apply_commands'),
    commands: commandBatchSchema,
  }),
])

export type TransactSubRequest = z.infer<typeof transactSubRequestSchema>

export function transactCallError(index: number, name: string, error: unknown): Error {
  const message = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error)
  const sentence = /[.!?]$/.test(message) ? message : `${message}.`
  return new Error(`transact call ${index + 1} (${name}) failed: ${sentence} No changes were applied.`)
}

function transactCallLabel(request: TransactSubRequest): string {
  switch (request.type) {
    case 'dispatch_command':
      return request.commandName
    case 'run_operator':
      return request.operatorId
    case 'run_action':
      return request.actionId
    case 'apply_commands':
      return 'apply_commands'
    default: {
      const unhandled: never = request
      throw new Error(`Unknown transact sub-request ${JSON.stringify(unhandled)}.`)
    }
  }
}

export async function applyTransact<T>(
  engine: EditorEngine,
  requests: readonly TransactSubRequest[],
  run: (request: TransactSubRequest) => Promise<T>,
): Promise<T[]> {
  engine.beginTransaction()
  const results: T[] = []
  try {
    for (const [index, request] of requests.entries()) {
      try {
        results.push(await run(request))
      } catch (error) {
        throw transactCallError(index, transactCallLabel(request), error)
      }
    }
    engine.endTransaction()
    return results
  } catch (error) {
    engine.cancelTransaction()
    throw error
  }
}
