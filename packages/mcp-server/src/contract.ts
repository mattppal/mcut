import { z } from 'zod'
import { operatorIds, operators, silenceCutOptionsSchema, type OperatorDefinition, type OperatorId } from '@mcut/editor'
import { elementIdSchema, listToolDefinitions } from '@mcut/timeline'
import { captionsCommandOptionsSchema, transcriptInputSchema } from '@mcut/transcription'
import { cancelExportInputSchema, exportVideoInputSchema, getExportInputSchema } from './export-protocol'

export * from './export-protocol'

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const toolProfileSchema = z.enum(['agent', 'full', 'commands'])

export type McpToolProfile = z.infer<typeof toolProfileSchema>

export const MCP_TOOL_PROFILES: McpToolProfile[] = toolProfileSchema.options

export function parseMcpToolProfile(value: unknown): McpToolProfile {
  return toolProfileSchema.catch('agent').parse(value)
}

export const operatorToolName = (id: OperatorId) => `operator_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`

const plainObjectJsonSchema = { type: 'object' }

export const toToolInputSchema = (schema: z.ZodType): Record<string, unknown> => {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  } catch {
    return plainObjectJsonSchema
  }
}

const EMPTY_INPUT = z.strictObject({})

const ELEMENT_ID_INPUT = elementIdSchema.describe('Optional video/audio element id. Defaults to selected media, then first video, then first audio.').optional()

const TOOL_INPUT = z.record(z.string(), z.unknown()).default({})

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
  'apply_captions',
  'apply_silence_cuts',
  'lint_project',
  'list_presets',
  'list_operators',
  'run_operator',
  'list_actions',
  'run_action',
  'undo',
  'redo',
  'export_video',
  'get_export',
  'cancel_export',
] as const

export type McpAgentToolName = (typeof MCP_AGENT_TOOL_NAMES)[number]

const transcriptInput = transcriptInputSchema.describe('Transcript JSON with word timings in source-media milliseconds, the same shape `mcut captions` reads.')

export const applyCaptionsInputSchema = captionsCommandOptionsSchema.extend({
  transcript: transcriptInput,
})

export const applySilenceCutsInputSchema = silenceCutOptionsSchema.extend({
  elementId: elementIdSchema.describe('The video/audio element to cut. It must play at 1x, with no time remap.'),
  transcript: transcriptInput,
})

export const MCP_TOOL_INPUTS = {
  get_summary: EMPTY_INPUT,
  get_project: EMPTY_INPUT,
  get_media_context: EMPTY_INPUT,
  get_audio_activity: z.strictObject({
    elementId: ELEMENT_ID_INPUT,
    includeWaveform: z.boolean().describe('Include compact max-amplitude waveform buckets for coarse inspection.').optional(),
    waveformBuckets: z.int().min(1).describe('Waveform bucket count when includeWaveform is true. Defaults to 128.').optional(),
    startMs: z.number().min(0).describe('Optional source start time in milliseconds. Defaults to the selected element source start.').optional(),
    endMs: z.number().min(0).describe('Optional source end time in milliseconds. Defaults to the selected element source end.').optional(),
    frameMs: z.number().min(1).describe('Analysis frame size in milliseconds. Defaults to 30.').optional(),
    threshold: z.number().min(0).describe('RMS activity threshold. Defaults to 0.004.').optional(),
    minSoundMs: z.number().min(0).describe('Sound runs shorter than this are treated as silence. Defaults to 120.').optional(),
    minSilenceMs: z.number().min(0).describe('Silence runs shorter than this are treated as sound. Defaults to 120.').optional(),
    paddingMs: z.number().min(0).describe('Trim this much from each returned silence window edge. Defaults to 0.').optional(),
  }),
  get_transcript: z.strictObject({
    includeWords: z.boolean().describe('Include absolute word timings for precise speech-boundary edits.').optional(),
  }),
  search_transcript: z.strictObject({
    query: z.string().trim().min(1, 'search_transcript requires a non-empty query string.'),
  }),
  ensure_transcript: z.strictObject({
    elementId: ELEMENT_ID_INPUT,
    replace: z.boolean().describe('When true, replace captions overlapping the target clip. Defaults to false.').optional(),
    language: z.string().trim().describe('Optional language hint for Whisper.').optional(),
  }),
  list_commands: EMPTY_INPUT,
  apply_commands: z.strictObject({
    commands: z
      .array(
        z.looseObject({
          type: z.string().describe('Timeline command type, e.g. splitElement, trimElement, addElement.'),
        }),
      )
      .min(1),
  }),
  apply_captions: applyCaptionsInputSchema,
  apply_silence_cuts: applySilenceCutsInputSchema,
  lint_project: EMPTY_INPUT,
  list_presets: EMPTY_INPUT,
  list_operators: EMPTY_INPUT,
  run_operator: z.strictObject({ operatorId: z.string(), input: TOOL_INPUT }),
  list_actions: EMPTY_INPUT,
  run_action: z.strictObject({ actionId: z.string(), input: TOOL_INPUT }),
  undo: EMPTY_INPUT,
  redo: EMPTY_INPUT,
  export_video: exportVideoInputSchema,
  get_export: getExportInputSchema,
  cancel_export: cancelExportInputSchema,
} satisfies Record<McpAgentToolName, z.ZodType>

const TOOL_DESCRIPTIONS: Record<McpAgentToolName, string> = {
  get_summary:
    'A compact textual rendering of the current project: tracks (topmost first), elements ' +
    'with ids/timing/keyframes/effects/transitions, and assets. Read this before editing, ' +
    'then use get_media_context/get_transcript for video metadata and transcript details.',
  get_project: 'The full project document as JSON (the serializable source of truth).',
  get_media_context:
    'Agent-friendly project/video metadata: project dimensions/fps/duration, playback, selection, ' +
    'assets, tracks, elements, clip source ranges, markers, and transcript availability. Use this before content-aware edits.',
  get_audio_activity:
    'Live bridge only: analyze a video/audio clip and return compact source sound/silence windows. ' +
    'Use this only through the connected browser for audio-aware inspection; do not fall back to ffmpeg. ' +
    'For spoken-word silence removal, prefer ensure_transcript followed by the live editor action transcript.remove-silence.',
  get_transcript:
    'Read the current transcript derived from caption elements. This never starts transcription. ' +
    'If no transcript exists and speech context is needed, call ensure_transcript in live bridge mode. ' +
    'Do not use ffmpeg or shell media analysis as a substitute for transcript-aware edits.',
  search_transcript:
    'Search the caption-derived transcript and return timeline times for matches. ' + 'Use this to locate spoken words/phrases before cutting or annotating.',
  ensure_transcript:
    'Live bridge only: if the target clip has no caption transcript, transcribe it with local Whisper in the connected browser, ' +
    'then apply word-timed captions to the timeline. Explicit tool only; get_transcript never auto-transcribes. ' +
    'Required before transcript-based silence removal when captions are missing.',
  list_commands: 'List every raw timeline command schema. Use this when apply_commands needs exact payload details.',
  apply_commands: 'Apply one or more serializable timeline commands in one undoable transaction, then return an updated project summary.',
  apply_captions:
    'Turn a transcript into word-timed caption elements and apply them as one undoable edit. ' +
    'Pass elementId to caption only the source span one video/audio clip plays, at its timeline position. ' +
    'styleId picks a caption style preset. Returns the updated project summary. ' +
    'Pass a timed transcript from a transcription provider. ensure_transcript already applies its captions, so there is no need to call this after it. ' +
    'Never invent a transcript when transcription fails. ' +
    'The result warns when the transcript matches no transcript in the project.',
  apply_silence_cuts:
    'Cut transcript silence out of one video/audio element (splits, ripple deletes, and edge trims) ' +
    'as one undoable edit. Returns the removed silence windows in source-media time and the updated project summary.',
  lint_project:
    'Check the project for cross-entity problems parseProject cannot reject (overlapping clips, missing assets, ' +
    'out-of-range keyframes, broken links, empty tracks) and return each issue with a severity and code.',
  list_presets: 'List platform delivery presets (dimensions, fps, safe areas, notes) to size a new project for its destination.',
  list_operators:
    'List user-level editor operators available to agents. Prefer these for UI-parity actions; ' + 'use raw command tools for low-level document edits.',
  run_operator: 'Run a user-level editor operator by id. Use list_operators first when you need the available ids and input schemas.',
  list_actions:
    'List browser editor actions available in the live editor, including menu/palette/hotkey actions. ' +
    'Use this in live bridge mode when you need exact UI parity or high-level agent actions such as transcript.remove-silence, effects.fade-open-close, ' +
    'and file.export-video, which renders and saves the video.',
  run_action:
    'Run a browser editor action by id in the live editor. These are the same actions used by menus, hotkeys, and the command palette. ' +
    'Prefer high-level actions over hand-authored command sequences when available. ' +
    'To export or render the finished video, run file.export-video with input {"format":"mp4"} or {"format":"webm"}.',
  undo: 'Undo the most recent edit.',
  redo: 'Redo the most recently undone edit.',
  export_video:
    'Live bridge only: render the whole timeline to a video file in Studio and write it to disk through the bridge. No dialog opens. ' +
    'Returns at once with a jobId while Studio renders in the background, which takes minutes for a long timeline. ' +
    'Then call get_export { jobId, waitMs: 20000 } until state is done, which reports the file path and byte size. One export runs at a time.',
  get_export:
    'Report an export job from export_video: state (rendering, writing, done, failed, or cancelled), percent, elapsedMs, ' +
    'an etaMs estimate while rendering, outputPath, and bytes once done. waitMs long-polls until the job ends or the wait runs out, ' +
    'so call it with waitMs 20000 until state is done.',
  cancel_export: 'Cancel the running export from export_video. Studio stops rendering and nothing is written.',
}

const toolDefinition = (name: McpAgentToolName): McpToolDefinition => ({
  name,
  description: TOOL_DESCRIPTIONS[name],
  inputSchema: toToolInputSchema(MCP_TOOL_INPUTS[name]),
})

export const MCP_AGENT_TOOL_DEFINITIONS: McpToolDefinition[] = MCP_AGENT_TOOL_NAMES.map(toolDefinition)

export const MCP_BRIDGE_ONLY_TOOL_NAMES = ['list_commands', 'apply_commands', 'run_operator'] as const satisfies readonly McpAgentToolName[]

export const MCP_BRIDGE_ONLY_TOOLS: McpToolDefinition[] = MCP_BRIDGE_ONLY_TOOL_NAMES.map(toolDefinition)

const staticToolCall = <Name extends McpAgentToolName>(name: Name) => z.object({ name: z.literal(name), arguments: MCP_TOOL_INPUTS[name] })

export const MCP_SERVER_STATIC_TOOL_CALL_SCHEMA = z.discriminatedUnion('name', [
  staticToolCall('get_summary'),
  staticToolCall('get_project'),
  staticToolCall('get_media_context'),
  staticToolCall('get_transcript'),
  staticToolCall('search_transcript'),
  staticToolCall('ensure_transcript'),
  staticToolCall('get_audio_activity'),
  staticToolCall('apply_captions'),
  staticToolCall('apply_silence_cuts'),
  staticToolCall('lint_project'),
  staticToolCall('list_presets'),
  staticToolCall('list_operators'),
  staticToolCall('list_actions'),
  staticToolCall('run_action'),
  staticToolCall('undo'),
  staticToolCall('redo'),
  staticToolCall('export_video'),
  staticToolCall('get_export'),
  staticToolCall('cancel_export'),
])

export type McpServerStaticToolCall = z.infer<typeof MCP_SERVER_STATIC_TOOL_CALL_SCHEMA>

export type McpServerStaticToolName = McpServerStaticToolCall['name']

const MCP_SERVER_STATIC_TOOL_NAMES: McpServerStaticToolName[] = MCP_SERVER_STATIC_TOOL_CALL_SCHEMA.options.map((option) => option.shape.name.value)

const staticToolNames = new Set<string>(MCP_SERVER_STATIC_TOOL_NAMES)

export const isMcpServerStaticToolName = (name: string): name is McpServerStaticToolName => staticToolNames.has(name)

export const MCP_SERVER_STATIC_TOOLS: McpToolDefinition[] = MCP_SERVER_STATIC_TOOL_NAMES.map(toolDefinition)

function operatorToolDefinitions(): McpToolDefinition[] {
  return operatorIds.map((id) => {
    const operator: OperatorDefinition = operators[id]
    return {
      name: operatorToolName(id),
      description: `Editor operator "${id}": ${operator.description}`,
      inputSchema: toToolInputSchema(operator.inputSchema),
    }
  })
}

export function listServerToolDefinitions(): McpToolDefinition[] {
  return [...MCP_SERVER_STATIC_TOOLS, ...operatorToolDefinitions(), ...listToolDefinitions()]
}

export function listMcpToolDefinitions(profile: McpToolProfile): McpToolDefinition[] {
  if (profile === 'commands') return listToolDefinitions()
  if (profile === 'agent') return MCP_AGENT_TOOL_DEFINITIONS
  return [...MCP_AGENT_TOOL_DEFINITIONS, ...operatorToolDefinitions(), ...listToolDefinitions()]
}
