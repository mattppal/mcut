import { z } from 'zod'
import { centerPersonOptionsSchema, operatorIds, operators, silenceCutOptionsSchema, type OperatorDefinition, type OperatorId } from '@mcut/editor'
import { elementIdSchema, listToolDefinitions, zoomCommandSchema } from '@mcut/timeline'
import { captionsCommandOptionsSchema, retakeOptionsSchema, transcriptInputSchema } from '@mcut/transcription'
import { cancelExportInputSchema, exportVideoInputSchema, getExportInputSchema } from './export-protocol'
import { PICTURE_TOOL_DESCRIPTIONS, PICTURE_TOOL_INPUTS } from './picture-tools'
import { commandBatchSchema } from './transact-shape'

export * from './export-protocol'
import { applySilenceCutsDescription, audioActivityDescription } from './audio-activity-target'
export { pickAudioActivitySource } from './audio-activity-target'
export { applyTransact, transactSubRequestSchema, type TransactSubRequest } from './transact-shape'

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

const ELEMENT_ID_INPUT = elementIdSchema.describe('Optional clip id. Defaults to the selected clip, then the first clip with source audio.').optional()

const TOOL_INPUT = z.record(z.string(), z.unknown()).default({})

export const MCP_AGENT_TOOL_NAMES = [
  'get_summary',
  'get_project',
  'get_media_context',
  'get_frame',
  'find_scene_changes',
  'get_contact_sheet',
  'get_audio_activity',
  'get_transcript',
  'search_transcript',
  'find_retakes',
  'ensure_transcript',
  'list_commands',
  'apply_commands',
  'apply_captions',
  'apply_silence_cuts',
  'lint_project',
  'list_zooms',
  'edit_zooms',
  'center_person',
  'list_presets',
  'list_operators',
  'run_operator',
  'list_actions',
  'run_action',
  'transact',
  'undo',
  'redo',
  'export_video',
  'get_export',
  'cancel_export',
  'import_media',
] as const

export type McpAgentToolName = (typeof MCP_AGENT_TOOL_NAMES)[number]

const transcriptInput = transcriptInputSchema.describe('Transcript JSON with word timings in source-media milliseconds, the same shape `mcut captions` reads.')

export const applyCaptionsInputSchema = captionsCommandOptionsSchema.extend({
  transcript: transcriptInput,
})

export const applySilenceCutsInputSchema = silenceCutOptionsSchema.extend({
  elementId: elementIdSchema.describe(
    'The clip to cut. It must play forward at 1x, with no time remap. A multicam is cut on its audio source, and one with none fails until setMulticamAudio.',
  ),
  transcript: transcriptInput,
})

export const MCP_TOOL_INPUTS = {
  get_summary: EMPTY_INPUT,
  get_project: EMPTY_INPUT,
  get_media_context: EMPTY_INPUT,
  get_frame: z.strictObject({
    timeMs: z.number().min(0).describe('Timeline time in milliseconds.'),
    elementId: elementIdSchema.describe('When set, render only this element. A multicam renders its composite.').optional(),
    maxWidth: z.int().min(64).max(3840).default(1280).describe('Maximum PNG width in pixels. Defaults to 1280. Height follows the project aspect ratio.'),
  }),
  ...PICTURE_TOOL_INPUTS,
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
  find_retakes: retakeOptionsSchema
    .extend({
      elementId: elementIdSchema
        .describe(
          "A clip with source audio, including a multicam and each piece left after cuts. The reply then includes that piece's words in audio-asset time.",
        )
        .optional(),
    })
    .strict(),
  ensure_transcript: z.strictObject({
    elementId: ELEMENT_ID_INPUT,
    replace: z.boolean().describe('When true, replace captions overlapping the target clip. Defaults to false.').optional(),
    language: z.string().trim().describe('Optional language hint for Whisper.').optional(),
  }),
  list_commands: EMPTY_INPUT,
  apply_commands: z.strictObject({
    commands: commandBatchSchema,
  }),
  transact: z.strictObject({
    calls: z
      .array(
        z.strictObject({
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .min(1)
      .max(100)
      .describe('Tool calls to apply as one undo step. Each name is a timeline command, an operator_* tool, run_operator, run_action, or apply_commands.'),
  }),
  apply_captions: applyCaptionsInputSchema,
  apply_silence_cuts: applySilenceCutsInputSchema,
  lint_project: EMPTY_INPUT,
  list_zooms: EMPTY_INPUT,
  edit_zooms: z.strictObject({ edits: z.array(zoomCommandSchema).min(1) }),
  center_person: z.strictObject({
    elementId: elementIdSchema.describe('Optional video or multicam element id. Defaults to the selected clip.').optional(),
    source: z.string().min(1).describe('Multicam only. The source key to follow. Defaults to "camera", then the first video source.').optional(),
    ...centerPersonOptionsSchema.shape,
  }),
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
  import_media: z.strictObject({
    paths: z
      .array(z.string().min(1))
      .min(1)
      .max(50)
      .describe('Absolute paths of local media files. A leading ~/ expands to the home folder. Studio probes each file and registers an asset.'),
  }),
} satisfies Record<McpAgentToolName, z.ZodType>

const importMediaBridgeFileSchema = z.strictObject({
  url: z.url(),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.int().nonnegative(),
  path: z.string().min(1),
})

export const importMediaBridgePayloadSchema = z.strictObject({
  files: z.array(importMediaBridgeFileSchema).min(1).max(50),
})

const importedMediaFileSchema = z.strictObject({
  path: z.string(),
  assetId: z.string(),
  name: z.string(),
  kind: z.enum(['video', 'audio', 'image']),
  durationMs: z.int().nonnegative().optional(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
})

const mediaImportFailureSchema = z.strictObject({
  path: z.string(),
  error: z.string(),
})

export const mediaImportReportSchema = z.strictObject({
  imported: z.array(importedMediaFileSchema),
  failed: z.array(mediaImportFailureSchema),
})

export type MediaImportReport = z.infer<typeof mediaImportReportSchema>

export type ImportMediaBridgeFile = z.infer<typeof importMediaBridgeFileSchema>

const TOOL_DESCRIPTIONS: Record<McpAgentToolName, string> = {
  get_summary:
    'A compact textual rendering of the current project: tracks (topmost first), elements ' +
    'with ids/timing/keyframes/effects/transitions, and assets. Read this before editing, ' +
    'then use get_media_context/get_transcript for video metadata and transcript details.',
  get_project: 'The full project document as JSON (the serializable source of truth).',
  get_media_context:
    'Agent-friendly project/video metadata: project dimensions/fps/duration, playback, selection, ' +
    'assets, tracks, elements, clip source ranges, markers, and transcript availability. Use this before content-aware edits.',
  get_frame:
    'Live bridge only. Render one timeline frame as a PNG. Call get_frame before placing a zoom or a crop. ' +
    'Pass elementId to render only that element, including a multicam composite. ' +
    'timeMs is the timeline position in milliseconds. maxWidth caps the PNG width and keeps the project aspect ratio. ' +
    'To find when something is on screen, call find_scene_changes and get_contact_sheet instead of stepping get_frame through time.',
  ...PICTURE_TOOL_DESCRIPTIONS,
  get_audio_activity: audioActivityDescription,
  get_transcript:
    'Read the current transcript derived from caption elements. This never starts transcription. ' +
    'If no transcript exists and speech context is needed, call ensure_transcript in live bridge mode. ' +
    'Do not use ffmpeg or shell media analysis as a substitute for transcript-aware edits.',
  search_transcript:
    'Search the caption-derived transcript and return timeline times for matches. ' + 'Use this to locate spoken words/phrases before cutting or annotating.',
  find_retakes:
    'Find retakes in the word-timed transcript. A phrase whose opening words are spoken again within maxLookaheadMs. ' +
    'Each candidate range runs from the abandoned take start to the kept take start in timeline ms, so cutting it keeps the last take. ' +
    'Candidates come last to first. Cut them in that order so no ripple delete shifts a range still to cut. ' +
    'Pass elementId for a clip with source audio, including a multicam and each piece left after the cuts. ' +
    'After the cuts, pass the full, unchanged transcript to apply_captions once per remaining clip, never a slice. ' +
    'Pass replace true until a call reports OK and false after; that call clears the caption track, so before cutting call find_retakes for every other captioned clip on it and rebuild each from that saved transcript. ' +
    'Cutting the caption track instead leaves later words late. ' +
    'Review abandonedText before cutting. Needs captions with word timings. Call ensure_transcript first.',
  ensure_transcript:
    'Live bridge only: if the target clip has no caption transcript, transcribe it with local Whisper in the connected browser, ' +
    'then apply word-timed captions to the timeline. Explicit tool only; get_transcript never auto-transcribes. ' +
    'Required before transcript-based silence removal when captions are missing.',
  list_commands: 'List every raw timeline command schema. Use this when apply_commands needs exact payload details.',
  apply_commands:
    'Apply one or more serializable timeline commands in one undoable transaction, then return an updated project summary. ' +
    'To mix commands with operators or actions in one undo step, use transact.',
  apply_captions:
    'Turn a transcript into word-timed caption elements and apply them as one undoable edit. ' +
    'Pass elementId to caption only the source span one clip plays, at its timeline position. A multicam uses its audio source. ' +
    'styleId picks a caption style preset. Returns the updated project summary. ' +
    'Pass a timed transcript from a transcription provider. ensure_transcript already applies its captions, so there is no need to call this after it. ' +
    'Never invent a transcript when transcription fails. ' +
    'The result warns when the transcript matches no transcript in the project. Caption words left in order after cuts still match.',
  apply_silence_cuts: applySilenceCutsDescription,
  lint_project:
    'Check the project for cross-entity problems parseProject cannot reject (overlapping clips, missing assets, ' +
    'out-of-range keyframes, broken links, empty tracks) and return each issue with a severity and code.',
  list_zooms:
    'List every zoom region in the project in one call: element id, source slot for multicam, element-local atMs, timeline startMs and endMs, ' +
    'inMs, holdMs, outMs, focus, scale, easing, and motionBlur. Read this before revising zooms.',
  edit_zooms:
    'Add, update, or remove any number of zoom regions as one undoable edit. Each edit is an addZoomRegion, updateZoomRegion, or removeZoomRegion command. ' +
    'If any edit is rejected, none apply. ' +
    'A zoom zooms in over inMs, holds, and zooms out over outMs. Presets: subtlePunchIn (1.15x) for an opening punch-in, detailZoom (1.3x) with rect or focus on the discussed screen region. ' +
    'Keep zooms subtle, keep easeOutExpo, and keep motionBlur on. On a multicam, set source to the screen key so the camera overlay stays put, or omit source to zoom the whole composite.',
  center_person:
    'Live bridge only: find the face on device in the connected editor and keep the person in frame as one undoable edit. Waits for the analysis. ' +
    'On a video, it crops to aspect, 9:16 by default, and the crop follows the face. ' +
    'When the crop aspect is within 1% of the project aspect, it also scales the clip to fill the frame and centers it in the same undo step. ' +
    'At another aspect the clip keeps its size, since it is likely picture in picture. Pass fill true or false to override. ' +
    'On a head overlay multicam, run it on the camera source, which is the default. The layout slot rect keeps its size and aspect, and the camera framing inside it follows the face. ' +
    'Returns the target, the sample count, the key count, the source range the keys cover, and whether it filled the frame. Undo removes it in one step.',
  list_presets: 'List platform delivery presets (dimensions, fps, safe areas, notes) to size a new project for its destination.',
  list_operators:
    'List user-level editor operators available to agents. Prefer these for UI-parity actions; ' + 'use raw command tools for low-level document edits.',
  run_operator:
    'Run a user-level editor operator by id. Use list_operators first when you need the available ids and input schemas. ' +
    'Several calls for one user request go in one transact.',
  list_actions:
    'List browser editor actions available in the live editor, including menu/palette/hotkey actions. ' +
    'Actions with humanOnly open a dialog for a person and run_action rejects them. ' +
    'Use this in live bridge mode when you need exact UI parity or high-level agent actions such as transcript.remove-silence and effects.fade-open-close. ' +
    'To render the finished video, use export_video instead.',
  run_action:
    'Run a browser editor action by id in the live editor. These are the same actions used by menus, hotkeys, and the command palette. ' +
    'Actions with humanOnly open a dialog for a person and are rejected. Actions without an input schema reject a non-empty input. ' +
    'Prefer high-level actions over hand-authored command sequences when available. ' +
    'Several calls for one user request go in one transact. ' +
    'To export or render the finished video, call export_video, then get_export until it is done.',
  transact:
    'When one user request needs more than one edit call, send them all in one transact, for example "make it square and fill the frame" or a fade in plus a fade out. ' +
    'Applies 1 to 100 tool calls as one undo step, so "undo that" removes the whole request. If any call fails, nothing stays applied. ' +
    'Each call is a timeline command, an operator_* tool, run_operator, run_action, or apply_commands.',
  undo: 'Undo the most recent edit. One undo step is one tool call or one whole transact, so a request made of separate calls outside transact only loses its last call.',
  redo: 'Redo the most recently undone edit.',
  export_video:
    'Live bridge only: render the whole timeline to a video file in Studio and write it to disk through the bridge. No dialog opens. ' +
    'Returns at once with a jobId while Studio renders in the background, which takes minutes for a long timeline. ' +
    'Then call get_export { jobId, waitMs: 20000 } until state is done, which reports the file path and byte size. One export runs at a time.',
  get_export:
    'Report an export job from export_video: state (starting, rendering, writing, done, failed, or cancelled), percent, elapsedMs, ' +
    'an etaMs estimate while rendering, outputPath, and bytes once done. waitMs long-polls until the job ends or the wait runs out, ' +
    'so call it with waitMs 20000 until state is done.',
  cancel_export: 'Cancel the running export from export_video. Studio stops rendering and nothing is written.',
  import_media:
    'Live bridge only. Import local media files into the connected Studio project by absolute path. ' +
    'The bridge checks each path, then Studio probes the file, registers the asset, and stores the bytes. ' +
    'The result lists imported assets and per-file failures. Place an imported asset with addElement or an operator.',
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
  staticToolCall('get_frame'),
  staticToolCall('find_scene_changes'),
  staticToolCall('get_contact_sheet'),
  staticToolCall('get_transcript'),
  staticToolCall('search_transcript'),
  staticToolCall('find_retakes'),
  staticToolCall('ensure_transcript'),
  staticToolCall('get_audio_activity'),
  staticToolCall('apply_captions'),
  staticToolCall('apply_silence_cuts'),
  staticToolCall('lint_project'),
  staticToolCall('list_zooms'),
  staticToolCall('edit_zooms'),
  staticToolCall('center_person'),
  staticToolCall('list_presets'),
  staticToolCall('list_operators'),
  staticToolCall('list_actions'),
  staticToolCall('run_action'),
  staticToolCall('transact'),
  staticToolCall('undo'),
  staticToolCall('redo'),
  staticToolCall('export_video'),
  staticToolCall('get_export'),
  staticToolCall('cancel_export'),
  staticToolCall('import_media'),
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
