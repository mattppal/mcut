/**
 * The MCP tool contract: names, descriptions, and input schemas for every
 * static tool, shared by the published MCP server, the live browser bridge,
 * and UIs that render the tool surface (e.g. Studio's /tools.json).
 *
 * Browser-safe: imports zod only — no transports, no node builtins.
 *
 * Two overlapping catalogs, on purpose:
 * - {@link MCP_SERVER_STATIC_TOOLS} (12) is what `createMcutMcpServerForTarget`
 *   registers. Raw commands and operators are exposed as their own tools
 *   (command type names and `operator_*`), not through a generic dispatcher.
 * - {@link MCP_BRIDGE_ONLY_TOOLS} (3) — `list_commands`, `apply_commands`,
 *   `run_operator` — are the live bridge's RPC vocabulary, handled by the
 *   browser editor. The published MCP server does not register them; agent
 *   docs that mention `apply_commands` only work against the bridge today.
 */
import { z } from 'zod'

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpToolProfile = 'agent' | 'full' | 'commands'

export const MCP_TOOL_PROFILES: McpToolProfile[] = ['agent', 'full', 'commands']

export function parseMcpToolProfile(value: unknown): McpToolProfile {
  return typeof value === 'string' && MCP_TOOL_PROFILES.includes(value as McpToolProfile)
    ? (value as McpToolProfile)
    : 'agent'
}

export const operatorToolName = (id: string) => `operator_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`

/** Zod schema → MCP tool `inputSchema`, with a plain-object fallback. */
export const toToolInputSchema = (schema: z.ZodType): Record<string, unknown> => {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >
  } catch {
    return { type: 'object' }
  }
}

const EMPTY_SCHEMA = {
  type: 'object' as const,
  properties: {},
  additionalProperties: false,
}

const AUDIO_ACTIVITY_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    elementId: {
      type: 'string' as const,
      description: 'Optional video/audio element id. Defaults to selected media, then first video, then first audio.',
    },
    includeWaveform: {
      type: 'boolean' as const,
      description: 'Include compact max-amplitude waveform buckets for coarse inspection.',
    },
    waveformBuckets: {
      type: 'integer' as const,
      minimum: 1,
      description: 'Waveform bucket count when includeWaveform is true. Defaults to 128.',
    },
    startMs: {
      type: 'number' as const,
      minimum: 0,
      description: 'Optional source start time in milliseconds. Defaults to the selected element source start.',
    },
    endMs: {
      type: 'number' as const,
      minimum: 0,
      description: 'Optional source end time in milliseconds. Defaults to the selected element source end.',
    },
    frameMs: {
      type: 'number' as const,
      minimum: 1,
      description: 'Analysis frame size in milliseconds. Defaults to 30.',
    },
    threshold: {
      type: 'number' as const,
      minimum: 0,
      description: 'RMS activity threshold. Defaults to 0.004.',
    },
    minSoundMs: {
      type: 'number' as const,
      minimum: 0,
      description: 'Sound runs shorter than this are treated as silence. Defaults to 120.',
    },
    minSilenceMs: {
      type: 'number' as const,
      minimum: 0,
      description: 'Silence runs shorter than this are treated as sound. Defaults to 120.',
    },
    paddingMs: {
      type: 'number' as const,
      minimum: 0,
      description: 'Trim this much from each returned silence window edge. Defaults to 0.',
    },
  },
  additionalProperties: false,
}

/** Every static tool an agent can see, in the public (tools.json) order. */
export const MCP_AGENT_TOOL_NAMES = [
  'get_summary',
  'get_project',
  'get_media_context',
  'get_audio_activity',
  'get_transcript',
  'search_transcript',
  'ensure_transcript',
  'list_commands',
  'apply_commands',
  'list_operators',
  'run_operator',
  'list_actions',
  'run_action',
  'undo',
  'redo',
] as const

export type McpAgentToolName = (typeof MCP_AGENT_TOOL_NAMES)[number]

const TOOL_DETAILS: Record<McpAgentToolName, Omit<McpToolDefinition, 'name'>> = {
  get_summary: {
    description:
      'A compact textual rendering of the current project: tracks (topmost first), elements ' +
      'with ids/timing/keyframes/effects/transitions, and assets. Read this before editing, ' +
      'then use get_media_context/get_transcript for video metadata and transcript details.',
    inputSchema: EMPTY_SCHEMA,
  },
  get_project: {
    description: 'The full project document as JSON (the serializable source of truth).',
    inputSchema: EMPTY_SCHEMA,
  },
  get_media_context: {
    description:
      'Agent-friendly project/video metadata: project dimensions/fps/duration, playback, selection, ' +
      'assets, tracks, elements, clip source ranges, markers, and transcript availability. Use this before content-aware edits.',
    inputSchema: EMPTY_SCHEMA,
  },
  get_audio_activity: {
    description:
      'Live bridge only: analyze a video/audio clip and return compact source sound/silence windows. ' +
      'Use this only through the connected browser for audio-aware inspection; do not fall back to ffmpeg. ' +
      'For spoken-word silence removal, prefer ensure_transcript followed by the live editor action transcript.remove-silence.',
    inputSchema: AUDIO_ACTIVITY_INPUT_SCHEMA,
  },
  get_transcript: {
    description:
      'Read the current transcript derived from caption elements. This never starts transcription. ' +
      'If no transcript exists and speech context is needed, call ensure_transcript in live bridge mode. ' +
      'Do not use ffmpeg or shell media analysis as a substitute for transcript-aware edits.',
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
  search_transcript: {
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
  ensure_transcript: {
    description:
      'Live bridge only: if the target clip has no caption transcript, transcribe it with local Whisper in the connected browser, ' +
      'then apply word-timed captions to the timeline. Explicit tool only; get_transcript never auto-transcribes. ' +
      'Required before transcript-based silence removal when captions are missing.',
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
  list_commands: {
    description:
      'List every raw timeline command schema. Use this when apply_commands needs exact payload details.',
    inputSchema: EMPTY_SCHEMA,
  },
  apply_commands: {
    description:
      'Apply one or more serializable timeline commands in one undoable transaction, then return an updated project summary.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        commands: {
          type: 'array' as const,
          minItems: 1,
          items: {
            type: 'object' as const,
            properties: {
              type: {
                type: 'string' as const,
                description: 'Timeline command type, e.g. splitElement, trimElement, addElement.',
              },
            },
            required: ['type'],
            additionalProperties: true,
          },
        },
      },
      required: ['commands'],
      additionalProperties: false,
    },
  },
  list_operators: {
    description:
      'List user-level editor operators available to agents. Prefer these for UI-parity actions; ' +
      'use raw command tools for low-level document edits.',
    inputSchema: EMPTY_SCHEMA,
  },
  run_operator: {
    description:
      'Run a user-level editor operator by id. Use list_operators first when you need the available ids and input schemas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        operatorId: { type: 'string' as const },
        input: { type: 'object' as const, additionalProperties: true },
      },
      required: ['operatorId'],
      additionalProperties: false,
    },
  },
  list_actions: {
    description:
      'List browser editor actions available in the live editor, including menu/palette/hotkey actions. ' +
      'Use this in live bridge mode when you need exact UI parity or high-level agent actions such as transcript.remove-silence and effects.fade-open-close.',
    inputSchema: EMPTY_SCHEMA,
  },
  run_action: {
    description:
      'Run a browser editor action by id in the live editor. These are the same actions used by menus, hotkeys, and the command palette. ' +
      'Prefer high-level actions over hand-authored command sequences when available.',
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
  undo: {
    description: 'Undo the most recent edit.',
    inputSchema: EMPTY_SCHEMA,
  },
  redo: {
    description: 'Redo the most recently undone edit.',
    inputSchema: EMPTY_SCHEMA,
  },
}

const toolDefinition = (name: McpAgentToolName): McpToolDefinition => ({
  name,
  ...TOOL_DETAILS[name],
})

export const MCP_AGENT_TOOL_DEFINITIONS: McpToolDefinition[] =
  MCP_AGENT_TOOL_NAMES.map(toolDefinition)

/** Tools the live bridge handles in the browser; not on the published server. */
export const MCP_BRIDGE_ONLY_TOOL_NAMES = [
  'list_commands',
  'apply_commands',
  'run_operator',
] as const satisfies readonly McpAgentToolName[]

export const MCP_BRIDGE_ONLY_TOOLS: McpToolDefinition[] =
  MCP_BRIDGE_ONLY_TOOL_NAMES.map(toolDefinition)

const MCP_SERVER_STATIC_TOOL_NAMES = [
  'get_summary',
  'get_project',
  'get_media_context',
  'get_transcript',
  'search_transcript',
  'ensure_transcript',
  'get_audio_activity',
  'list_operators',
  'list_actions',
  'run_action',
  'undo',
  'redo',
] as const satisfies readonly McpAgentToolName[]

/** Static tools registered by the published MCP server, in registration order. */
export const MCP_SERVER_STATIC_TOOLS: McpToolDefinition[] =
  MCP_SERVER_STATIC_TOOL_NAMES.map(toolDefinition)

export interface OperatorToolSource {
  id: string
  description: string
  inputSchema: z.ZodType
}

/** Editor operators as MCP tool definitions (`operator_<id>`). */
export function operatorToolDefinitions(operators: OperatorToolSource[]): McpToolDefinition[] {
  return operators.map((operator) => ({
    name: operatorToolName(operator.id),
    description: `Editor operator "${operator.id}": ${operator.description}`,
    inputSchema: toToolInputSchema(operator.inputSchema),
  }))
}

export interface McpToolSources {
  operators: OperatorToolSource[]
  /** Raw timeline command tools, e.g. `listToolDefinitions()` from `@mcut/timeline`. */
  commands: McpToolDefinition[]
}

/** The exact tool list the published MCP server registers. */
export function listServerToolDefinitions(sources: McpToolSources): McpToolDefinition[] {
  return [...MCP_SERVER_STATIC_TOOLS, ...operatorToolDefinitions(sources.operators), ...sources.commands]
}

/** The tool surface for a given profile, as served by Studio's /tools.json. */
export function listMcpToolDefinitions(
  profile: McpToolProfile,
  sources: McpToolSources,
): McpToolDefinition[] {
  if (profile === 'commands') return sources.commands
  if (profile === 'agent') return MCP_AGENT_TOOL_DEFINITIONS
  return [...MCP_AGENT_TOOL_DEFINITIONS, ...operatorToolDefinitions(sources.operators), ...sources.commands]
}
