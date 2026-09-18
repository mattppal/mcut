/**
 * mcut as an MCP server: every editor command becomes an MCP tool, straight
 * from the zod command table, plus the user-level operators from @mcut/editor
 * and the static tools (summary, project, undo/redo).
 *
 * The target can be a local EditorEngine or a live browser tab. Export stays
 * in the browser (WebCodecs); MCP edits the project document/state.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import {
  OperatorError,
  listOperators,
  operatorIds,
  runOperator,
  summarizeEngine,
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
  type Project,
  type ProjectTranscriptOptions,
} from '@mcut/timeline'
import { searchCaptions } from '@mcut/transcription'
import { listServerToolDefinitions, operatorToolName } from './contract'

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
}

export interface McutMcpServerOptions {
  engine: EditorEngine
  /** Called after every successful edit — persist the project here. */
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

function transcriptOptions(args: unknown): ProjectTranscriptOptions {
  const input = (args ?? {}) as { includeWords?: unknown }
  return { includeWords: input.includeWords === true }
}

function transcriptQuery(args: unknown): string | null {
  const input = (args ?? {}) as { query?: unknown }
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  return query.length > 0 ? query : null
}

function searchProjectTranscript(project: Project, query: string): unknown {
  const captionRefs = getProjectCaptions(project)
  const captions = captionRefs.map((ref) => ref.caption)
  const byId = new Map<string, (typeof captionRefs)[number]>(
    captionRefs.map((ref) => [ref.caption.id, ref]),
  )
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

function createEngineTarget(
  engine: EditorEngine,
  onChange: () => void | Promise<void>,
): McutMcpTarget {
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
      engine.dispatch(parseCommand(Object.assign({}, input, { type: commandName })))
      await onChange()
    },
  }
}

/**
 * Build the server around an existing engine. The caller owns the transport:
 * `await createMcutMcpServer({ engine }).connect(new StdioServerTransport())`.
 */
export function createMcutMcpServer(options: McutMcpServerOptions): Server {
  return createMcutMcpServerForTarget({
    target: createEngineTarget(options.engine, options.onChange ?? (() => {})),
    name: options.name,
    version: options.version,
  })
}

/** Build the same MCP tool surface around any target, including a live browser tab. */
export function createMcutMcpServerForTarget(options: McutMcpServerForTargetOptions): Server {
  const { target } = options
  const tools = listServerToolDefinitions()
  const operatorIdsByTool = new Map(operatorIds.map((id) => [operatorToolName(id), id]))

  const server = new Server(
    { name: options.name ?? 'mcut', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools as unknown as Tool[],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      switch (name) {
        case 'get_summary':
          return text(await target.getSummary())
        case 'get_project':
          return text(JSON.stringify(await target.getProject(), null, 2))
        case 'get_media_context':
          if (!target.getMediaContext) return failure('get_media_context is not available on this target.')
          return text(JSON.stringify(await target.getMediaContext(), null, 2))
        case 'get_transcript':
          if (!target.getTranscript) return failure('get_transcript is not available on this target.')
          return text(JSON.stringify(await target.getTranscript(transcriptOptions(args)), null, 2))
        case 'search_transcript': {
          if (!target.searchTranscript) return failure('search_transcript is not available on this target.')
          const query = transcriptQuery(args)
          if (!query) return failure('search_transcript requires a non-empty query string.')
          return text(JSON.stringify(await target.searchTranscript(query), null, 2))
        }
        case 'ensure_transcript': {
          if (!target.ensureTranscript) return failure('ensure_transcript is not available on this target.')
          const result = await target.ensureTranscript(args ?? {})
          const suffix =
            result === undefined ? '' : `\n\nResult:\n${JSON.stringify(result, null, 2)}`
          return text(`OK: transcript ensured.${suffix}\n\n${await target.getSummary()}`)
        }
        case 'get_audio_activity': {
          if (!target.getAudioActivity) return failure('get_audio_activity is not available on this target.')
          return text(JSON.stringify(await target.getAudioActivity(args ?? {}), null, 2))
        }
        case 'list_operators':
          return text(JSON.stringify(await target.listOperators(), null, 2))
        case 'list_actions':
          return text(JSON.stringify(await target.listActions(), null, 2))
        case 'run_action': {
          const input = (args ?? {}) as { actionId?: unknown; input?: unknown }
          if (typeof input.actionId !== 'string') return failure('run_action requires an actionId string.')
          const result = await target.runAction(input.actionId, input.input ?? {})
          const suffix =
            result === undefined ? '' : `\n\nResult:\n${JSON.stringify(result, null, 2)}`
          return text(`OK: action ${input.actionId} applied.${suffix}\n\n${await target.getSummary()}`)
        }
        case 'undo': {
          if (!(await target.undo())) return failure('Nothing to undo.')
          return text(`Undone.\n\n${await target.getSummary()}`)
        }
        case 'redo': {
          if (!(await target.redo())) return failure('Nothing to redo.')
          return text(`Redone.\n\n${await target.getSummary()}`)
        }
        default: {
          const operatorId = operatorIdsByTool.get(name)
          if (operatorId) {
            const result = await target.runOperator(operatorId, args ?? {})
            const suffix =
              result === undefined ? '' : `\n\nResult:\n${JSON.stringify(result, null, 2)}`
            return text(`OK: operator ${operatorId} applied.${suffix}\n\n${await target.getSummary()}`)
          }
          await target.dispatchCommand(name, args ?? {})
          return text(`OK: ${name} applied.\n\n${await target.getSummary()}`)
        }
      }
    } catch (error) {
      if (
        error instanceof CommandError ||
        error instanceof ProjectFormatError ||
        error instanceof OperatorError
      ) {
        return failure(`${error.name} (${error.code}): ${error.message}`)
      }
      return failure(error instanceof Error ? error.message : String(error))
    }
  })

  return server
}
