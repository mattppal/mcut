"use client";

import { useEffect } from "react";
import {
  createEditorOperatorRegistry,
  OperatorError,
  registerCoreOperators,
} from "@mcut/editor";
import {
  analyzeAudioActivity,
  type AudioActivity,
  type AudioActivityOptions,
  type AudioActivityWindow,
} from "@mcut/media";
import { useEditor } from "@mcut/react";
import {
  CommandError,
  ProjectFormatError,
  getElementLocation,
  getProjectCaptions,
  getProjectMediaContext,
  getProjectTranscript,
  getSourceSpanMs,
  listToolDefinitions,
  summarizeProject,
  type AnyCommand,
  type AssetRef,
  type AudioElement,
  type EditorEngine,
  type ElementId,
  type Project,
  type ProjectTranscriptOptions,
  type Track,
  type VideoElement,
} from "@mcut/timeline";
import { searchCaptions } from "@mcut/transcription";
import { toast } from "sonner";
import {
  formatShortcut,
  getEditorAction,
  isActionEnabled,
  listEditorActions,
  runEditorAction,
} from "./action-registry";
import { editorClipboard } from "./editor-clipboard";
import { useEditorUI } from "./editor-ui";
import { ensureTranscriptForBridge } from "./live-mcp-transcript";
import { MCP_AGENT_TOOL_NAMES, mcpOperatorToolName } from "./mcp-tool-contract";

interface BridgeRequest {
  id: string;
  type: string;
  payload?: unknown;
}

interface CommandPayload {
  commandName: string;
  input?: Record<string, unknown>;
}

interface OperatorPayload {
  operatorId: string;
  input?: unknown;
}

interface ActionPayload {
  actionId: string;
  input?: unknown;
}

interface ApplyCommandsPayload {
  commands: AnyCommand[];
}

interface AudioActivityPayload extends AudioActivityOptions {
  elementId?: string;
  includeWaveform?: boolean;
}

interface AudioActivitySource {
  asset: AssetRef;
  element: VideoElement | AudioElement;
  track: Track;
}

interface SourceRange {
  startMs: number;
  endMs: number;
  durationMs: number;
}

type AudioActivityAnalyzer = (
  src: string,
  options?: AudioActivityOptions,
) => Promise<AudioActivity | null>;

const operators = registerCoreOperators(createEditorOperatorRegistry());
const DEFAULT_BRIDGE_PORT = "44737";
const BRIDGE_CONFIG_STORAGE_KEY = "mcut.liveMcpBridge";

export const LIVE_MCP_STATIC_TOOL_REQUESTS = MCP_AGENT_TOOL_NAMES;

export const LIVE_MCP_DYNAMIC_TOOL_REQUESTS = ["dispatch_command"] as const;

export const LIVE_MCP_REQUEST_TYPES = [
  ...LIVE_MCP_STATIC_TOOL_REQUESTS,
  ...LIVE_MCP_DYNAMIC_TOOL_REQUESTS,
] as const;

export function liveMcpOperatorToolName(operatorId: string): string {
  return mcpOperatorToolName(operatorId);
}

function viewState(engine: EditorEngine): string {
  const playback = engine.playback.state;
  const selection = engine.selection.elementIds;
  return (
    `Playhead: ${(playback.currentTimeMs / 1000).toFixed(2)}s` +
    ` (${playback.isPlaying ? "playing" : "paused"})` +
    ` · Selection: ${selection.length > 0 ? selection.join(", ") : "none"}`
  );
}

function summarize(engine: EditorEngine): string {
  return `${summarizeProject(engine.project)}\n${viewState(engine)}`;
}

function transcriptOptions(value: unknown): ProjectTranscriptOptions {
  if (!isRecord(value)) return {};
  return { includeWords: value.includeWords === true };
}

function transcriptQuery(value: unknown): string {
  if (!isRecord(value) || typeof value.query !== "string" || !value.query.trim()) {
    throw new Error("search_transcript requires a non-empty query string.");
  }
  return value.query.trim();
}

function searchProjectTranscript(project: Project, query: string): unknown {
  const captionRefs = getProjectCaptions(project);
  const captions = captionRefs.map((ref) => ref.caption);
  const byId = new Map<string, (typeof captionRefs)[number]>(
    captionRefs.map((ref) => [ref.caption.id, ref]),
  );
  const matches = searchCaptions(captions, query).map((match) => {
    const ref = byId.get(match.captionId);
    const text = ref?.caption.text ?? "";
    return {
      ...match,
      text: text.slice(match.startChar, match.endChar),
      captionText: text,
      trackId: ref?.trackId,
      trackName: ref?.trackName,
      startMs: match.timeMs,
      endMs: match.endTimeMs,
    };
  });
  return { query, count: matches.length, matches };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function commandPayload(value: unknown): CommandPayload {
  if (!isRecord(value) || typeof value.commandName !== "string") {
    throw new Error("Invalid dispatch_command payload.");
  }
  return {
    commandName: value.commandName,
    input: isRecord(value.input) ? value.input : {},
  };
}

function applyCommandsPayload(value: unknown): ApplyCommandsPayload {
  if (!isRecord(value) || !Array.isArray(value.commands)) {
    throw new Error("Invalid apply_commands payload.");
  }
  const commands = value.commands.map((command) => {
    if (!isRecord(command) || typeof command.type !== "string") {
      throw new Error("apply_commands requires commands with a string type.");
    }
    return command as AnyCommand;
  });
  if (commands.length === 0) throw new Error("apply_commands requires at least one command.");
  return { commands };
}

function operatorPayload(value: unknown): OperatorPayload {
  if (!isRecord(value) || typeof value.operatorId !== "string") {
    throw new Error("Invalid run_operator payload.");
  }
  return {
    operatorId: value.operatorId,
    input: value.input ?? {},
  };
}

function actionPayload(value: unknown): ActionPayload {
  if (!isRecord(value) || typeof value.actionId !== "string") {
    throw new Error("Invalid run_action payload.");
  }
  return { actionId: value.actionId, input: value.input ?? {} };
}

function isAudioActivityElement(element: unknown): element is VideoElement | AudioElement {
  return (
    typeof element === "object" &&
    element !== null &&
    "type" in element &&
    (element.type === "video" || element.type === "audio")
  );
}

function audioActivityPayload(value: unknown): AudioActivityPayload {
  if (!isRecord(value)) return {};
  const startMs = optionalFiniteNumber(value.startMs);
  const endMs = optionalFiniteNumber(value.endMs);
  const frameMs = optionalFiniteNumber(value.frameMs);
  const threshold = optionalFiniteNumber(value.threshold);
  const minSoundMs = optionalFiniteNumber(value.minSoundMs);
  const minSilenceMs = optionalFiniteNumber(value.minSilenceMs);
  const paddingMs = optionalFiniteNumber(value.paddingMs);
  const waveformBuckets = optionalFiniteNumber(value.waveformBuckets);
  return {
    ...(typeof value.elementId === "string" ? { elementId: value.elementId } : {}),
    ...(typeof value.includeWaveform === "boolean" ? { includeWaveform: value.includeWaveform } : {}),
    ...(startMs !== undefined ? { startMs } : {}),
    ...(endMs !== undefined ? { endMs } : {}),
    ...(frameMs !== undefined ? { frameMs } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(minSoundMs !== undefined ? { minSoundMs } : {}),
    ...(minSilenceMs !== undefined ? { minSilenceMs } : {}),
    ...(paddingMs !== undefined ? { paddingMs } : {}),
    ...(waveformBuckets !== undefined ? { waveformBuckets } : {}),
  };
}

function pickAudioActivitySource(
  engine: EditorEngine,
  payload: AudioActivityPayload,
): AudioActivitySource {
  const project = engine.project;
  if (payload.elementId) {
    const location = getElementLocation(project, payload.elementId as ElementId);
    if (!location || !isAudioActivityElement(location.element)) {
      throw new Error(`Element "${payload.elementId}" is not a video or audio clip.`);
    }
    const asset = project.assets[location.element.assetId];
    if (!asset) throw new Error(`Element "${payload.elementId}" has no asset.`);
    return { asset, element: location.element, track: location.track };
  }

  for (const elementId of engine.selection.elementIds) {
    const location = getElementLocation(project, elementId);
    if (!location || !isAudioActivityElement(location.element)) continue;
    const asset = project.assets[location.element.assetId];
    if (asset) return { asset, element: location.element, track: location.track };
  }

  const candidates = project.tracks.flatMap((track) =>
    track.elements
      .filter((element): element is VideoElement | AudioElement =>
        isAudioActivityElement(element) && !!project.assets[element.assetId],
      )
      .map((element) => ({ asset: project.assets[element.assetId]!, element, track })),
  );
  const source =
    candidates.find((candidate) => candidate.element.type === "video") ??
    candidates.find((candidate) => candidate.element.type === "audio");
  if (!source) throw new Error("Add a video or audio clip to the timeline first.");
  return source;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function audioActivityRange(source: AudioActivitySource, payload: AudioActivityPayload): SourceRange {
  const elementStartMs = source.element.trimStartMs;
  const elementEndMs = elementStartMs + getSourceSpanMs(source.element);
  const assetEndMs = source.asset.durationMs ?? elementEndMs;
  const maxEndMs = Math.min(assetEndMs, elementEndMs);
  const startMs = clamp(payload.startMs ?? elementStartMs, elementStartMs, maxEndMs);
  const endMs = clamp(payload.endMs ?? maxEndMs, startMs, maxEndMs);
  if (endMs <= startMs) {
    throw new Error("get_audio_activity requires a non-empty source range.");
  }
  return { startMs, endMs, durationMs: endMs - startMs };
}

function offsetWindow(window: AudioActivityWindow, offsetMs: number): AudioActivityWindow {
  return {
    ...window,
    startMs: window.startMs + offsetMs,
    endMs: window.endMs + offsetMs,
  };
}

function silentSummary(durationMs: number): AudioActivity["summary"] {
  return {
    soundMs: 0,
    silenceMs: durationMs,
    soundFraction: 0,
    silenceFraction: 1,
    peakRms: 0,
    peakAmplitude: 0,
  };
}

export async function handleGetAudioActivity(
  engine: EditorEngine,
  value: unknown,
  analyzer: AudioActivityAnalyzer = analyzeAudioActivity,
): Promise<unknown> {
  const payload = audioActivityPayload(value);
  const source = pickAudioActivitySource(engine, payload);
  const range = audioActivityRange(source, payload);
  const waveformBuckets =
    payload.includeWaveform === true ? Math.max(1, Math.floor(payload.waveformBuckets ?? 128)) : undefined;
  const options: AudioActivityOptions = {
    startMs: range.startMs,
    endMs: range.endMs,
    ...(payload.frameMs !== undefined ? { frameMs: payload.frameMs } : {}),
    ...(payload.threshold !== undefined ? { threshold: payload.threshold } : {}),
    ...(payload.minSoundMs !== undefined ? { minSoundMs: payload.minSoundMs } : {}),
    ...(payload.minSilenceMs !== undefined ? { minSilenceMs: payload.minSilenceMs } : {}),
    ...(payload.paddingMs !== undefined ? { paddingMs: payload.paddingMs } : {}),
    ...(waveformBuckets !== undefined ? { waveformBuckets } : {}),
  };
  const activity = await analyzer(source.asset.src, options);
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
      timeBasis: "source-ms",
    },
  };

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
    };
  }

  return {
    ...base,
    hasAudio: true,
    durationMs: activity.durationMs,
    soundWindows: activity.soundWindows.map((window) => offsetWindow(window, range.startMs)),
    silenceWindows: activity.silenceWindows.map((window) => offsetWindow(window, range.startMs)),
    summary: activity.summary,
    ...(activity.waveform ? { waveform: activity.waveform } : {}),
  };
}

function serializeError(error: unknown) {
  if (
    error instanceof CommandError ||
    error instanceof ProjectFormatError ||
    error instanceof OperatorError
  ) {
    return { name: error.name, code: error.code, message: error.message };
  }
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function handleLiveMcpRequest(
  engine: EditorEngine,
  ui: ReturnType<typeof useEditorUI>,
  request: BridgeRequest,
): Promise<unknown> {
  const context = { engine, ui, clipboard: editorClipboard };
  switch (request.type) {
    case "get_summary":
      return summarize(engine);
    case "get_project":
      return engine.toJSON();
    case "get_media_context":
      return getProjectMediaContext(engine.project, {
        playback: engine.playback.state,
        selection: engine.selection,
      });
    case "get_transcript":
      return getProjectTranscript(engine.project, transcriptOptions(request.payload));
    case "search_transcript":
      return searchProjectTranscript(engine.project, transcriptQuery(request.payload));
    case "ensure_transcript":
      return await ensureTranscriptForBridge(engine, request.payload);
    case "get_audio_activity":
      return await handleGetAudioActivity(engine, request.payload);
    case "list_commands":
      return listToolDefinitions();
    case "apply_commands": {
      const { commands } = applyCommandsPayload(request.payload);
      engine.transact(() => {
        for (const command of commands) engine.dispatch(command);
      });
      return { applied: commands.length, summary: summarize(engine) };
    }
    case "list_operators":
      return operators.listAvailable({ engine }).map((operator) => ({
        id: operator.id,
        label: operator.label,
        category: operator.category,
        enabled: operator.enabled,
        disabledReason: operator.disabledReason,
        tool: liveMcpOperatorToolName(operator.id),
        description: operator.description,
      }));
    case "list_actions":
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
      }));
    case "undo":
      return engine.undo();
    case "redo":
      return engine.redo();
    case "run_operator": {
      const { operatorId, input } = operatorPayload(request.payload);
      return await operators.run(operatorId, { engine }, input);
    }
    case "dispatch_command": {
      const { commandName, input } = commandPayload(request.payload);
      engine.dispatch({ type: commandName, ...input });
      return null;
    }
    case "run_action": {
      const { actionId, input } = actionPayload(request.payload);
      const action = getEditorAction(actionId);
      if (!action) throw new Error(`Unknown editor action "${actionId}".`);
      if (!isActionEnabled(action, context)) {
        throw new Error(`Editor action "${actionId}" is disabled.`);
      }
      return runEditorAction(action, { ...context, input, throwOnError: true }) ?? null;
    }
    default:
      throw new Error(`Unknown live MCP request "${request.type}".`);
  }
}

function readStoredBridgeConfig(): { port: string; token: string | null } | null {
  try {
    const raw = window.sessionStorage.getItem(BRIDGE_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || typeof value.port !== "string") return null;
    return {
      port: value.port || DEFAULT_BRIDGE_PORT,
      token: typeof value.token === "string" ? value.token : null,
    };
  } catch {
    return null;
  }
}

function writeStoredBridgeConfig(config: { port: string; token: string | null }): void {
  try {
    window.sessionStorage.setItem(BRIDGE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage failures; explicit URL params still connect for this page load.
  }
}

function bridgeConfig(): { port: string; token: string | null; quiet: boolean } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.has("mcpBridge")) {
    const config = {
      port: params.get("mcpBridge") || DEFAULT_BRIDGE_PORT,
      token: params.get("mcpToken"),
    };
    writeStoredBridgeConfig(config);
    return { ...config, quiet: false };
  }
  const stored = readStoredBridgeConfig();
  return stored ? { ...stored, quiet: true } : null;
}

export function LiveMcpBridge() {
  const engine = useEditor();
  const ui = useEditorUI();

  useEffect(() => {
    const config = bridgeConfig();
    if (!config) return;

    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const scheduleConnect = () => {
      reconnectTimer = setTimeout(start, config.quiet ? 5000 : 1000);
    };

    const start = () => {
      if (!config.quiet) {
        connect();
        return;
      }
      fetch(`http://127.0.0.1:${config.port}/status`, { mode: "no-cors" })
        .then(() => connect())
        .catch(() => {
          if (!stopped) scheduleConnect();
        });
    };

    const connect = () => {
      if (stopped) return;
      const url = new URL(`ws://127.0.0.1:${config.port}/mcut-mcp`);
      if (config.token) url.searchParams.set("token", config.token);
      socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        socket?.send(
          JSON.stringify({
            type: "hello",
            payload: {
              projectName: engine.project.name,
              userAgent: window.navigator.userAgent,
            },
          }),
        );
        if (!config.quiet) toast.success("Live MCP connected");
      });

      socket.addEventListener("message", (event) => {
        void (async () => {
          let request: BridgeRequest | null = null;
          try {
            request = JSON.parse(String(event.data)) as BridgeRequest;
            const result = await handleLiveMcpRequest(engine, ui, request);
            socket?.send(JSON.stringify({ id: request.id, ok: true, result }));
          } catch (error) {
            socket?.send(
              JSON.stringify({
                id: request?.id,
                ok: false,
                error: serializeError(error),
              }),
            );
          }
        })();
      });

      socket.addEventListener("close", () => {
        if (stopped) return;
        scheduleConnect();
      });

      socket.addEventListener("error", () => {
        socket?.close();
      });
    };

    start();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [engine, ui]);

  return null;
}
