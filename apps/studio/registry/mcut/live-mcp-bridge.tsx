'use client'

import { useState } from 'react'
import { OperatorError, applyCommands, listOperators, parseOperatorId, runOperator, summarizeEngine, type OperatorId } from '@mcut/editor'
import { analyzeAudioActivity, type AudioActivity, type AudioActivityOptions, type AudioActivityWindow } from '@mcut/media'
import { useEditor, useWebSocket } from '@mcut/react'
import {
  CommandError,
  ProjectFormatError,
  getElementLocation,
  getProjectCaptions,
  getProjectMediaContext,
  getProjectTranscript,
  getSourceSpanMs,
  listToolDefinitions,
  parseCommand,
  type AssetRef,
  type AudioElement,
  type EditorEngine,
  type Project,
  type Track,
  type VideoElement,
} from '@mcut/timeline'
import { searchCaptions } from '@mcut/transcription'
import { toast } from 'sonner'
import { z } from 'zod'
import { formatShortcut, getEditorAction, isActionEnabled, listEditorActions, runEditorAction } from './action-registry'
import { parseBridgeFrame, type BridgeRequest } from './bridge-request'
import { editorClipboard } from './editor-clipboard'
import { useEditorUI } from './editor-ui'
import { ensureTranscriptForBridge } from './live-mcp-transcript'
import { clamp } from './math'
import { MCP_AGENT_TOOL_NAMES, MCP_TOOL_INPUTS, operatorToolName } from '@mcut/mcp-server/contract'

type AudioActivityPayload = z.infer<typeof MCP_TOOL_INPUTS.get_audio_activity>

interface AudioActivitySource {
  asset: AssetRef
  element: VideoElement | AudioElement
  track: Track
}

interface SourceRange {
  startMs: number
  endMs: number
  durationMs: number
}

type AudioActivityAnalyzer = (src: string, options?: AudioActivityOptions) => Promise<AudioActivity | null>

const DEFAULT_BRIDGE_PORT = '44737'
const BRIDGE_CONFIG_STORAGE_KEY = 'mcut.liveMcpBridge'

export const LIVE_MCP_STATIC_TOOL_REQUESTS = MCP_AGENT_TOOL_NAMES

export const LIVE_MCP_DYNAMIC_TOOL_REQUESTS = ['dispatch_command'] as const

export const LIVE_MCP_REQUEST_TYPES = [...LIVE_MCP_STATIC_TOOL_REQUESTS, ...LIVE_MCP_DYNAMIC_TOOL_REQUESTS] as const

export function liveMcpOperatorToolName(operatorId: OperatorId): string {
  return operatorToolName(operatorId)
}

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

function isAudioActivityElement(element: unknown): element is VideoElement | AudioElement {
  return typeof element === 'object' && element !== null && 'type' in element && (element.type === 'video' || element.type === 'audio')
}

function pickAudioActivitySource(engine: EditorEngine, payload: AudioActivityPayload): AudioActivitySource {
  const project = engine.project
  if (payload.elementId) {
    const location = getElementLocation(project, payload.elementId)
    if (!location || !isAudioActivityElement(location.element)) {
      throw new Error(`Element "${payload.elementId}" is not a video or audio clip.`)
    }
    const asset = project.assets[location.element.assetId]
    if (!asset) throw new Error(`Element "${payload.elementId}" has no asset.`)
    return { asset, element: location.element, track: location.track }
  }

  for (const elementId of engine.selection.elementIds) {
    const location = getElementLocation(project, elementId)
    if (!location || !isAudioActivityElement(location.element)) continue
    const asset = project.assets[location.element.assetId]
    if (asset) return { asset, element: location.element, track: location.track }
  }

  const candidates = project.tracks.flatMap((track) =>
    track.elements
      .filter((element): element is VideoElement | AudioElement => isAudioActivityElement(element) && !!project.assets[element.assetId])
      .map((element) => ({ asset: project.assets[element.assetId]!, element, track })),
  )
  const source = candidates.find((candidate) => candidate.element.type === 'video') ?? candidates.find((candidate) => candidate.element.type === 'audio')
  if (!source) throw new Error('Add a video or audio clip to the timeline first.')
  return source
}

function audioActivityRange(source: AudioActivitySource, payload: AudioActivityPayload): SourceRange {
  const elementStartMs = source.element.trimStartMs
  const elementEndMs = elementStartMs + getSourceSpanMs(source.element)
  const assetEndMs = source.asset.durationMs ?? elementEndMs
  const maxEndMs = Math.min(assetEndMs, elementEndMs)
  const startMs = clamp(payload.startMs ?? elementStartMs, elementStartMs, maxEndMs)
  const endMs = clamp(payload.endMs ?? maxEndMs, startMs, maxEndMs)
  if (endMs <= startMs) {
    throw new Error('get_audio_activity requires a non-empty source range.')
  }
  return { startMs, endMs, durationMs: endMs - startMs }
}

function offsetWindow(window: AudioActivityWindow, offsetMs: number): AudioActivityWindow {
  return {
    ...window,
    startMs: window.startMs + offsetMs,
    endMs: window.endMs + offsetMs,
  }
}

function silentSummary(durationMs: number): AudioActivity['summary'] {
  return {
    soundMs: 0,
    silenceMs: durationMs,
    soundFraction: 0,
    silenceFraction: 1,
    peakRms: 0,
    peakAmplitude: 0,
  }
}

export async function handleGetAudioActivity(
  engine: EditorEngine,
  payload: AudioActivityPayload,
  analyzer: AudioActivityAnalyzer = analyzeAudioActivity,
): Promise<unknown> {
  const source = pickAudioActivitySource(engine, payload)
  const range = audioActivityRange(source, payload)
  const waveformBuckets = payload.includeWaveform === true ? Math.max(1, Math.floor(payload.waveformBuckets ?? 128)) : undefined
  const options: AudioActivityOptions = {
    startMs: range.startMs,
    endMs: range.endMs,
    ...(payload.frameMs !== undefined ? { frameMs: payload.frameMs } : {}),
    ...(payload.threshold !== undefined ? { threshold: payload.threshold } : {}),
    ...(payload.minSoundMs !== undefined ? { minSoundMs: payload.minSoundMs } : {}),
    ...(payload.minSilenceMs !== undefined ? { minSilenceMs: payload.minSilenceMs } : {}),
    ...(payload.paddingMs !== undefined ? { paddingMs: payload.paddingMs } : {}),
    ...(waveformBuckets !== undefined ? { waveformBuckets } : {}),
  }
  const activity = await analyzer(source.asset.src, options)
  const base = {
    elementId: source.element.id,
    trackId: source.track.id,
    trackName: source.track.name,
    asset: {
      id: source.asset.id,
      kind: source.asset.kind,
      ...(source.asset.name ? { name: source.asset.name } : {}),
      ...(source.asset.durationMs !== undefined ? { durationMs: source.asset.durationMs } : {}),
      ...(source.asset.mimeType ? { mimeType: source.asset.mimeType } : {}),
      ...(source.asset.width !== undefined ? { width: source.asset.width } : {}),
      ...(source.asset.height !== undefined ? { height: source.asset.height } : {}),
    },
    source: {
      startMs: range.startMs,
      endMs: range.endMs,
      durationMs: range.durationMs,
      elementStartMs: source.element.startMs,
      elementEndMs: source.element.startMs + source.element.durationMs,
      elementSourceStartMs: source.element.trimStartMs,
      elementSourceEndMs: source.element.trimStartMs + getSourceSpanMs(source.element),
      hasTimeMap: !!source.element.timeMap,
      reversed: !!source.element.reversed,
      timeBasis: 'source-ms',
    },
  }

  if (!activity) {
    return {
      ...base,
      hasAudio: false,
      durationMs: range.durationMs,
      soundWindows: [],
      silenceWindows: [
        {
          startMs: range.startMs,
          endMs: range.endMs,
          durationMs: range.durationMs,
          rms: 0,
          peakRms: 0,
          peakAmplitude: 0,
        },
      ],
      summary: silentSummary(range.durationMs),
    }
  }

  return {
    ...base,
    hasAudio: true,
    durationMs: activity.durationMs,
    soundWindows: activity.soundWindows.map((window) => offsetWindow(window, range.startMs)),
    silenceWindows: activity.silenceWindows.map((window) => offsetWindow(window, range.startMs)),
    summary: activity.summary,
    ...(activity.waveform ? { waveform: activity.waveform } : {}),
  }
}

function serializeError(error: unknown) {
  if (error instanceof CommandError || error instanceof ProjectFormatError || error instanceof OperatorError) {
    return { name: error.name, code: error.code, message: error.message }
  }
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  }
}

export async function handleLiveMcpRequest(engine: EditorEngine, ui: ReturnType<typeof useEditorUI>, request: BridgeRequest): Promise<unknown> {
  const context = { engine, ui, clipboard: editorClipboard }
  switch (request.type) {
    case 'get_summary':
      return summarizeEngine(engine)
    case 'get_project':
      return engine.toJSON()
    case 'get_media_context':
      return getProjectMediaContext(engine.project, {
        playback: engine.playback.state,
        selection: engine.selection,
      })
    case 'get_transcript':
      return getProjectTranscript(engine.project, request.payload)
    case 'search_transcript':
      return searchProjectTranscript(engine.project, request.payload.query)
    case 'ensure_transcript':
      return await ensureTranscriptForBridge(engine, request.payload)
    case 'get_audio_activity':
      return await handleGetAudioActivity(engine, request.payload)
    case 'list_commands':
      return listToolDefinitions()
    case 'apply_commands': {
      const commands = request.payload.commands.map(parseCommand)
      applyCommands(engine, commands)
      return { applied: commands.length, summary: summarizeEngine(engine) }
    }
    case 'list_operators':
      return listOperators({ engine }).map((operator) => ({
        id: operator.id,
        label: operator.label,
        category: operator.category,
        enabled: operator.enabled,
        disabledReason: operator.disabledReason,
        tool: liveMcpOperatorToolName(operator.id),
        description: operator.description,
      }))
    case 'list_actions':
      return listEditorActions().map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        category: action.category,
        enabled: isActionEnabled(action, context),
        shortcut: formatShortcut(action.shortcut),
        palette: action.palette ?? true,
        inputSchema: action.inputSchema,
        operator: action.operator?.id,
      }))
    case 'undo':
      return engine.undo()
    case 'redo':
      return engine.redo()
    case 'run_operator': {
      const { operatorId, input } = request.payload
      return await runOperator(parseOperatorId(operatorId), { engine }, input)
    }
    case 'dispatch_command': {
      const { commandName, input } = request.payload
      engine.dispatch(parseCommand({ ...input, type: commandName }))
      return null
    }
    case 'run_action': {
      const { actionId, input } = request.payload
      const action = getEditorAction(actionId)
      if (!action) throw new Error(`Unknown editor action "${actionId}".`)
      if (!isActionEnabled(action, context)) {
        throw new Error(`Editor action "${actionId}" is disabled.`)
      }
      return runEditorAction(action, { ...context, input, throwOnError: true }) ?? null
    }
    default: {
      const unhandled: never = request
      throw new Error(`Unknown live MCP request ${JSON.stringify(unhandled)}.`)
    }
  }
}

const storedBridgeConfigSchema = z.object({
  port: z.string(),
  token: z.string().nullable().catch(null),
})

interface BridgeLaunch {
  source: 'url' | 'storage'
  port: string
  token: string | null
}

const RECONNECT_DELAY_MS: Record<BridgeLaunch['source'], number> = { url: 1000, storage: 5000 }

function readStoredBridgeLaunch(): BridgeLaunch | null {
  try {
    const raw = window.sessionStorage.getItem(BRIDGE_CONFIG_STORAGE_KEY)
    if (!raw) return null
    const stored = storedBridgeConfigSchema.safeParse(JSON.parse(raw))
    if (!stored.success) return null
    return { source: 'storage', port: stored.data.port || DEFAULT_BRIDGE_PORT, token: stored.data.token }
  } catch {
    return null
  }
}

function rememberBridgeLaunch(launch: BridgeLaunch): void {
  try {
    window.sessionStorage.setItem(BRIDGE_CONFIG_STORAGE_KEY, JSON.stringify({ port: launch.port, token: launch.token }))
  } catch {}
}

function readBridgeLaunch(): BridgeLaunch | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const port = params.get('mcpBridge')
  if (port === null) return readStoredBridgeLaunch()
  return { source: 'url', port: port || DEFAULT_BRIDGE_PORT, token: params.get('mcpToken') }
}

function bridgeSocketUrl(launch: BridgeLaunch): string {
  const url = new URL(`ws://127.0.0.1:${launch.port}/mcut-mcp`)
  if (launch.token) url.searchParams.set('token', launch.token)
  return url.href
}

async function respondToBridgeFrame(socket: WebSocket, data: unknown, engine: EditorEngine, ui: ReturnType<typeof useEditorUI>): Promise<void> {
  const frame = parseBridgeFrame(data)
  if (!frame.ok) {
    socket.send(JSON.stringify({ id: frame.id, ok: false, error: frame.error }))
    return
  }
  const { request } = frame
  try {
    const result = await handleLiveMcpRequest(engine, ui, request)
    socket.send(JSON.stringify({ id: request.id, ok: true, result }))
  } catch (error) {
    socket.send(JSON.stringify({ id: request.id, ok: false, error: serializeError(error) }))
  }
}

function BridgeConnection({ launch }: { launch: BridgeLaunch }) {
  const engine = useEditor()
  const ui = useEditorUI()
  useWebSocket(
    bridgeSocketUrl(launch),
    {
      onOpen: (socket) => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            payload: { projectName: engine.project.name, userAgent: window.navigator.userAgent },
          }),
        )
        if (launch.source === 'url') {
          rememberBridgeLaunch(launch)
          toast.success('Live MCP connected')
        }
      },
      onMessage: (socket, event) => {
        void respondToBridgeFrame(socket, event.data, engine, ui)
      },
    },
    { reconnectDelayMs: RECONNECT_DELAY_MS[launch.source] },
  )
  return null
}

export function LiveMcpBridge() {
  const [launch] = useState(readBridgeLaunch)
  return launch === null ? null : <BridgeConnection launch={launch} />
}
