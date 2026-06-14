/**
 * mcut as an MCP server: every registered editor command becomes an MCP tool,
 * straight from the zod command registry — plus user-level operators from
 * @mcut/editor and a handful of static tools (summary, project, undo/redo).
 *
 * The target can be a local EditorEngine or a live browser tab. Export stays
 * in the browser (WebCodecs); MCP edits the project document/state.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  EditorOperatorRegistry,
  OperatorError,
  createEditorOperatorRegistry,
  registerCoreOperators,
} from '@mcut/editor'
import {
  CommandError,
  EditorEngine,
  ProjectFormatError,
  getProjectCaptions,
  getProjectMediaContext,
  getProjectTranscript,
  listCommands,
  summarizeProject,
  type Project,
  type ProjectTranscriptOptions,
} from '@mcut/timeline'
import { searchCaptions } from '@mcut/transcription'
import { z } from 'zod'

export interface McutMcpTarget {
  getSummary(): string | Promise<string>
  getProject(): unknown | Promise<unknown>
  getMediaContext?(): unknown | Promise<unknown>
  getTranscript?(options?: ProjectTranscriptOptions): unknown | Promise<unknown>
  searchTranscript?(query: string): unknown | Promise<unknown>
  ensureTranscript?(input: unknown): unknown | Promise<unknown>
  listActions(): unknown | Promise<unknown>
  listOperators(): unknown | Promise<unknown>
  runAction(actionId: string, input: unknown): unknown | Promise<unknown>
  undo(): boolean | Promise<boolean>
  redo(): boolean | Promise<boolean>
  runOperator(operatorId: string, input: unknown): unknown | Promise<unknown>
  dispatchCommand(commandName: string, input: unknown): unknown | Promise<unknown>
}

export interface McutMcpServerOptions {
  engine: EditorEngine
  /** Called after every successful edit — persist the project here. */
  onChange?: () => void | Promise<void>
  /** Defaults to the core operator set. */
  operators?: EditorOperatorRegistry
  name?: string
  version?: string
}

export interface McutMcpServerForTargetOptions {
  target: McutMcpTarget
  /** Defaults to the core operator set. Used for tool schema generation. */
  operators?: EditorOperatorRegistry
  name?: string
  version?: string
}

export const operatorToolName = (id: string) => `operator_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`

const toInputSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as { type: 'object' }

const STATIC_TOOLS = [
  {
    name: 'get_summary',
    description:
      'A compact textual rendering of the current project: tracks (topmost first), elements ' +
      'with ids/timing/keyframes/effects/transitions, and assets. Read this before editing, ' +
      'then use get_media_context/get_transcript for video metadata and transcript details.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'get_project',
    description: 'The full project document as JSON (the serializable source of truth).',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'get_media_context',
    description:
      'Agent-friendly project/video metadata: project dimensions/fps/duration, playback, selection, ' +
      'assets, tracks, elements, clip source ranges, markers, and transcript availability. Use this before content-aware edits.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'get_transcript',
    description:
      'Read the current transcript derived from caption elements. This never starts transcription. ' +
      'If no transcript exists and speech context is needed, call ensure_transcript in live bridge mode.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        includeWords: {
          type: 'boolean' as const,
          description: 'Include absolute word timings for precise speech-boundary edits.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_transcript',
    description:
      'Search the caption-derived transcript and return timeline times for matches. ' +
      'Use this to locate spoken words/phrases before cutting or annotating.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'ensure_transcript',
    description:
      'Live bridge only: if the target clip has no caption transcript, transcribe it with local Whisper in the connected browser, ' +
      'then apply word-timed captions to the timeline. Explicit tool only; get_transcript never auto-transcribes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        elementId: {
          type: 'string' as const,
          description: 'Optional video/audio element id. Defaults to selected media, then first video, then first audio.',
        },
        replace: {
          type: 'boolean' as const,
          description: 'When true, replace captions overlapping the target clip. Defaults to false.',
        },
        language: {
          type: 'string' as const,
          description: 'Optional language hint for Whisper.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_operators',
    description:
      'List user-level editor operators available to agents. Prefer these for UI-parity actions; ' +
      'use raw command tools for low-level document edits.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'list_actions',
    description:
      'List browser editor actions available in the live editor, including menu/palette/hotkey actions. ' +
      'Use this in live bridge mode when you need exact UI parity.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'run_action',
    description:
      'Run a browser editor action by id in the live editor. These are the same actions used by menus, hotkeys, and the command palette.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        actionId: { type: 'string' as const },
        input: { type: 'object' as const, additionalProperties: true },
      },
      required: ['actionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'undo',
    description: 'Undo the most recent edit.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'redo',
    description: 'Redo the most recently undone edit.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
]

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })
const failure = (value: string) => ({ ...text(value), isError: true })

function viewState(engine: EditorEngine): string {
  const playback = engine.playback.state
  const selection = engine.selection.elementIds
  return (
    `Playhead: ${(playback.currentTimeMs / 1000).toFixed(2)}s` +
    ` (${playback.isPlaying ? 'playing' : 'paused'})` +
    ` · Selection: ${selection.length > 0 ? selection.join(', ') : 'none'}`
  )
}

function summarizeEngine(engine: EditorEngine): string {
  return `${summarizeProject(engine.project)}\n${viewState(engine)}`
}

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
  operators: EditorOperatorRegistry,
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
    listActions: () => [],
    listOperators: () =>
      operators.listAvailable({ engine }).map((operator) => ({
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
      const result = await operators.run(operatorId, { engine }, input ?? {})
      await onChange()
      return result
    },
    dispatchCommand: async (commandName, input) => {
      engine.dispatch({ type: commandName, ...((input ?? {}) as Record<string, unknown>) })
      await onChange()
    },
  }
}

/**
 * Build the server around an existing engine. The caller owns the transport:
 * `await createMcutMcpServer({ engine }).connect(new StdioServerTransport())`.
 */
export function createMcutMcpServer(options: McutMcpServerOptions): Server {
  const operators = options.operators ?? registerCoreOperators(createEditorOperatorRegistry())
  return createMcutMcpServerForTarget({
    target: createEngineTarget(options.engine, operators, options.onChange ?? (() => {})),
    operators,
    name: options.name,
    version: options.version,
  })
}

/** Build the same MCP tool surface around any target, including a live browser tab. */
export function createMcutMcpServerForTarget(options: McutMcpServerForTargetOptions): Server {
  const { target } = options
  const operators = options.operators ?? registerCoreOperators(createEditorOperatorRegistry())

  const commandTools = listCommands().map((command) => ({
    name: command.type,
    description: command.description,
    inputSchema: toInputSchema(command.payloadSchema as z.ZodType),
  }))

  const operatorIdsByTool = new Map<string, string>()
  const operatorTools = operators.list().map((operator) => {
    const name = operatorToolName(operator.id)
    operatorIdsByTool.set(name, operator.id)
    return {
      name,
      description: `Editor operator "${operator.id}": ${operator.description}`,
      inputSchema: toInputSchema(operator.inputSchema as z.ZodType),
    }
  })

  const server = new Server(
    { name: options.name ?? 'mcut', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...STATIC_TOOLS, ...operatorTools, ...commandTools],
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
