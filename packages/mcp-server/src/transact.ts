import { applyCommands, operatorIds, parseOperatorId, runOperator, summarizeEngine, type OperatorId } from '@mcut/editor'
import { EditorEngine, listToolDefinitions, parseCommand } from '@mcut/timeline'
import { z } from 'zod'
import { MCP_TOOL_INPUTS, operatorToolName } from './contract'
import { timelineRangeRemoval } from './remove-ranges'
import { applyTransact, transactCallError, type TransactSubRequest } from './transact-shape'

const PASS_THROUGH = ['run_operator', 'run_action', 'apply_commands', 'remove_ranges'] as const

type PassThroughName = (typeof PASS_THROUGH)[number]

function isPassThrough(name: string): name is PassThroughName {
  return PASS_THROUGH.some((allowed) => allowed === name)
}

function allowedTransactToolNames(): string[] {
  return [...listToolDefinitions().map((tool) => tool.name), ...operatorIds.map((id) => operatorToolName(id)), ...PASS_THROUGH]
}

type TransactCall = z.infer<typeof MCP_TOOL_INPUTS.transact>['calls'][number]

function passThrough(name: PassThroughName, args: unknown): TransactSubRequest {
  if (name === 'run_operator') {
    const parsed = MCP_TOOL_INPUTS.run_operator.parse(args)
    return { type: 'run_operator', operatorId: parsed.operatorId, input: parsed.input }
  }
  if (name === 'run_action') {
    const parsed = MCP_TOOL_INPUTS.run_action.parse(args)
    return { type: 'run_action', actionId: parsed.actionId, input: parsed.input }
  }
  if (name === 'remove_ranges') {
    const parsed = MCP_TOOL_INPUTS.remove_ranges.parse(args)
    if (parsed.time === 'source') {
      throw new Error('inside transact, remove_ranges takes timeline ranges only. Call it on its own for time "source". It is already one undo step')
    }
    const { type, ranges } = timelineRangeRemoval(parsed)
    return { type: 'dispatch_command', commandName: type, input: { ranges } }
  }
  const parsed = MCP_TOOL_INPUTS.apply_commands.parse(args)
  return { type: 'apply_commands', commands: parsed.commands }
}

function rejectTransactName(name: string): Error {
  return new Error(
    `transact cannot run "${name}". Allowed tools are timeline commands (list_commands), operator_* tools, run_operator, run_action, and apply_commands.`,
  )
}

const HISTORY_OPERATORS: ReadonlySet<string> = new Set<OperatorId>(['edit.undo', 'edit.redo'])

function historyOperator(request: TransactSubRequest): string | undefined {
  if (request.type === 'run_operator' && HISTORY_OPERATORS.has(request.operatorId)) return request.operatorId
  if (request.type === 'run_action' && HISTORY_OPERATORS.has(request.actionId)) return request.actionId
  return undefined
}

function rejectHistoryOperator(id: string): Error {
  return new Error(`transact cannot run "${id}". One transact is one undo step, so it cannot contain undo or redo. Call the undo or redo tool on its own.`)
}

export function translateTransactCalls(calls: readonly TransactCall[]): TransactSubRequest[] {
  const allowed = new Set(allowedTransactToolNames())
  const operatorsByTool = new Map<string, OperatorId>()
  for (const id of operatorIds) operatorsByTool.set(operatorToolName(id), id)
  const commandNames = new Set<string>(listToolDefinitions().map((tool) => tool.name))
  const requests: TransactSubRequest[] = calls.map((call, index) => {
    const args = call.arguments ?? {}
    if (!allowed.has(call.name)) throw rejectTransactName(call.name)
    if (isPassThrough(call.name)) {
      try {
        return passThrough(call.name, args)
      } catch (error) {
        throw transactCallError(index, call.name, error)
      }
    }
    const operatorId = operatorsByTool.get(call.name)
    if (operatorId !== undefined) return { type: 'run_operator', operatorId, input: args }
    if (commandNames.has(call.name)) return { type: 'dispatch_command', commandName: call.name, input: args }
    throw rejectTransactName(call.name)
  })
  for (const request of requests) {
    const id = historyOperator(request)
    if (id !== undefined) throw rejectHistoryOperator(id)
  }
  return requests
}

async function runEngineSubRequest(engine: EditorEngine, request: TransactSubRequest): Promise<unknown> {
  switch (request.type) {
    case 'dispatch_command':
      engine.dispatch(parseCommand({ ...request.input, type: request.commandName }))
      return null
    case 'run_operator':
      return await runOperator(parseOperatorId(request.operatorId), { engine }, request.input)
    case 'run_action':
      throw new Error(`Browser action "${request.actionId}" is only available through a live browser bridge.`)
    case 'apply_commands': {
      const commands = request.commands.map((command) => parseCommand(command))
      applyCommands(engine, commands)
      return { applied: commands.length, summary: summarizeEngine(engine) }
    }
    default: {
      const unhandled: never = request
      throw new Error(`Unknown transact sub-request ${JSON.stringify(unhandled)}.`)
    }
  }
}

export async function runEngineTransact(
  engine: EditorEngine,
  requests: readonly TransactSubRequest[],
  onChange: () => void | Promise<void>,
): Promise<unknown[]> {
  const results = await applyTransact(engine, requests, (request) => runEngineSubRequest(engine, request))
  await onChange()
  return results
}
