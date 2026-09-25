import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  OperatorError,
  PLATFORM_PRESETS,
  applyCommands,
  lintProject,
  listOperators,
  operatorIds,
  planSilenceCuts,
  runOperator,
  summarizeEngine,
  withPlayheadDefaults,
  type OperatorId,
} from '@mcut/editor'
import {
  CommandError,
  EditorEngine,
  ProjectFormatError,
  getProjectCaptions,
  getProjectMediaContext,
  getProjectTranscript,
  parseCommand,
  parseProject,
  type BuiltinCommand,
  type Project,
  type ProjectTranscriptOptions,
} from '@mcut/timeline'
import { buildCaptionsCommand, searchCaptions } from '@mcut/transcription'
import { z } from 'zod'
import {
  MCP_SERVER_STATIC_TOOL_CALL_SCHEMA,
  isMcpServerStaticToolName,
  listServerToolDefinitions,
  operatorToolName,
  type McpServerStaticToolCall,
} from './contract'

export interface McutMcpTarget {
  getSummary(): string | Promise<string>
  getProject(): unknown | Promise<unknown>
  getMediaContext?(): unknown | Promise<unknown>
  getTranscript?(options?: ProjectTranscriptOptions): unknown | Promise<unknown>
  searchTranscript?(query: string): unknown | Promise<unknown>
  ensureTranscript?(input: unknown): unknown | Promise<unknown>
  getAudioActivity?(input: unknown): unknown | Promise<unknown>
  listActions(): unknown | Promise<unknown>
  listOperators(): unknown | Promise<unknown>
  runAction(actionId: string, input: unknown): unknown | Promise<unknown>
  undo(): boolean | Promise<boolean>
  redo(): boolean | Promise<boolean>
  runOperator(operatorId: OperatorId, input: unknown): unknown | Promise<unknown>
  dispatchCommand(commandName: string, input: unknown): unknown | Promise<unknown>
  applyCommands(commands: BuiltinCommand[]): unknown | Promise<unknown>
}

export interface McutMcpServerOptions {
  engine: EditorEngine
  onChange?: () => void | Promise<void>
  name?: string
  version?: string
}

export interface McutMcpServerForTargetOptions {
  target: McutMcpTarget
  name?: string
  version?: string
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })
const failure = (value: string) => ({ ...text(value), isError: true })

const targetProject = async (target: McutMcpTarget): Promise<Project> => parseProject(await target.getProject())

type ToolResult = ReturnType<typeof text> | ReturnType<typeof failure>

const withResult = (lead: string, result: unknown) => (result === undefined ? lead : `${lead}\n\nResult:\n${JSON.stringify(result, null, 2)}`)

function searchProjectTranscript(project: Project, query: string): unknown {
  const captionRefs = getProjectCaptions(project)
  const captions = captionRefs.map((ref) => ref.caption)
  const byId = new Map<string, (typeof captionRefs)[number]>(captionRefs.map((ref) => [ref.caption.id, ref]))
  const matches = searchCaptions(captions, query).map((match) => {
    const ref = byId.get(match.captionId)
    const text = ref?.caption.text ?? ''
    return {
      ...match,
      text: text.slice(match.startChar, match.endChar),
      captionText: text,
      trackId: ref?.trackId,
      trackName: ref?.trackName,
      startMs: match.timeMs,
      endMs: match.endTimeMs,
    }
  })
  return { query, count: matches.length, matches }
}

function createEngineTarget(engine: EditorEngine, onChange: () => void | Promise<void>): McutMcpTarget {
  return {
    getSummary: () => summarizeEngine(engine),
    getProject: () => engine.toJSON(),
    getMediaContext: () =>
      getProjectMediaContext(engine.project, {
        playback: engine.playback.state,
        selection: engine.selection,
      }),
    getTranscript: (options) => getProjectTranscript(engine.project, options),
    searchTranscript: (query) => searchProjectTranscript(engine.project, query),
    ensureTranscript: async () => {
      throw new Error('ensure_transcript requires a live browser bridge connected to an editor tab.')
    },
    getAudioActivity: async () => {
      throw new Error('get_audio_activity requires a live browser bridge connected to an editor tab.')
    },
    listActions: () => [],
    listOperators: () =>
      listOperators({ engine }).map((operator) => ({
        id: operator.id,
        label: operator.label,
        category: operator.category,
        enabled: operator.enabled,
        disabledReason: operator.disabledReason,
        tool: operatorToolName(operator.id),
        description: operator.description,
      })),
    undo: async () => {
      const applied = engine.undo()
      if (applied) await onChange()
      return applied
    },
    redo: async () => {
      const applied = engine.redo()
      if (applied) await onChange()
      return applied
    },
    runAction: async (actionId) => {
      throw new Error(`Browser action "${actionId}" is only available through a live browser bridge.`)
    },
    runOperator: async (operatorId, input) => {
      const result = await runOperator(operatorId, { engine }, input ?? {})
      await onChange()
      return result
    },
    dispatchCommand: async (commandName, input) => {
      engine.dispatch(withPlayheadDefaults(engine, parseCommand(Object.assign({}, input, { type: commandName }))))
      await onChange()
    },
    applyCommands: async (commands) => {
      applyCommands(engine, commands)
      await onChange()
    },
  }
}

async function callStaticTool(target: McutMcpTarget, call: McpServerStaticToolCall): Promise<ToolResult> {
  switch (call.name) {
    case 'get_summary':
      return text(await target.getSummary())
    case 'get_project':
      return text(JSON.stringify(await target.getProject(), null, 2))
    case 'get_media_context':
      if (!target.getMediaContext) return failure('get_media_context is not available on this target.')
      return text(JSON.stringify(await target.getMediaContext(), null, 2))
    case 'get_transcript':
      if (!target.getTranscript) return failure('get_transcript is not available on this target.')
      return text(JSON.stringify(await target.getTranscript(call.arguments), null, 2))
    case 'search_transcript':
      if (!target.searchTranscript) return failure('search_transcript is not available on this target.')
      return text(JSON.stringify(await target.searchTranscript(call.arguments.query), null, 2))
    case 'ensure_transcript': {
      if (!target.ensureTranscript) return failure('ensure_transcript is not available on this target.')
      const result = await target.ensureTranscript(call.arguments)
      return text(`${withResult('OK: transcript ensured.', result)}\n\n${await target.getSummary()}`)
    }
    case 'get_audio_activity':
      if (!target.getAudioActivity) return failure('get_audio_activity is not available on this target.')
      return text(JSON.stringify(await target.getAudioActivity(call.arguments), null, 2))
    case 'lint_project':
      return text(JSON.stringify(lintProject(await targetProject(target)), null, 2))
    case 'list_presets':
      return text(JSON.stringify(PLATFORM_PRESETS, null, 2))
    case 'apply_captions': {
      const { transcript, ...options } = call.arguments
      const command = buildCaptionsCommand(await targetProject(target), transcript, options)
      await target.applyCommands([command])
      return text(`OK: ${command.captions.length} caption(s) applied.\n\n${await target.getSummary()}`)
    }
    case 'apply_silence_cuts': {
      const { elementId, transcript, ...options } = call.arguments
      const plan = planSilenceCuts(await targetProject(target), elementId, transcript, options)
      if (plan.silences.length === 0) return text('No silences found, nothing to cut.')
      await target.applyCommands(plan.commands)
      const result = { silences: plan.silences, removedMs: plan.removedMs }
      return text(`${withResult(`OK: ${plan.silences.length} silence(s) cut.`, result)}\n\n${await target.getSummary()}`)
    }
    case 'list_operators':
      return text(JSON.stringify(await target.listOperators(), null, 2))
    case 'list_actions':
      return text(JSON.stringify(await target.listActions(), null, 2))
    case 'run_action': {
      const { actionId, input } = call.arguments
      const result = await target.runAction(actionId, input)
      return text(`${withResult(`OK: action ${actionId} applied.`, result)}\n\n${await target.getSummary()}`)
    }
    case 'undo':
      if (!(await target.undo())) return failure('Nothing to undo.')
      return text(`Undone.\n\n${await target.getSummary()}`)
    case 'redo':
      if (!(await target.redo())) return failure('Nothing to redo.')
      return text(`Redone.\n\n${await target.getSummary()}`)
  }
}

export function createMcutMcpServer(options: McutMcpServerOptions): Server {
  return createMcutMcpServerForTarget({
    target: createEngineTarget(options.engine, options.onChange ?? (() => {})),
    name: options.name,
    version: options.version,
  })
}

export function createMcutMcpServerForTarget(options: McutMcpServerForTargetOptions): Server {
  const { target } = options
  const tools = listServerToolDefinitions()
  const operatorIdsByTool = new Map(operatorIds.map((id) => [operatorToolName(id), id]))

  const server = new Server({ name: options.name ?? 'mcut', version: options.version ?? '0.1.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools as unknown as Tool[],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      if (isMcpServerStaticToolName(name)) {
        const call = MCP_SERVER_STATIC_TOOL_CALL_SCHEMA.safeParse({ name, arguments: args ?? {} })
        if (!call.success) return failure(`${name}: ${z.prettifyError(call.error)}`)
        return await callStaticTool(target, call.data)
      }
      const operatorId = operatorIdsByTool.get(name)
      if (operatorId) {
        const result = await target.runOperator(operatorId, args ?? {})
        return text(`${withResult(`OK: operator ${operatorId} applied.`, result)}\n\n${await target.getSummary()}`)
      }
      await target.dispatchCommand(name, args ?? {})
      return text(`OK: ${name} applied.\n\n${await target.getSummary()}`)
    } catch (error) {
      if (error instanceof CommandError || error instanceof ProjectFormatError || error instanceof OperatorError) {
        return failure(`${error.name} (${error.code}): ${error.message}`)
      }
      return failure(error instanceof Error ? error.message : String(error))
    }
  })

  return server
}
