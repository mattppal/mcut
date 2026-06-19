import { describe, expect, test } from "bun:test";
import { createEditorOperatorRegistry, registerCoreOperators } from "@mcut/editor";
import {
  createMcutMcpServer,
  operatorToolName as serverOperatorToolName,
} from "@mcut/mcp-server";
import {
  EditorEngine,
  createProject,
  getElementLocation,
  listCommands,
} from "@mcut/timeline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GET as toolsJson, dynamic as toolsJsonDynamic } from "../../app/tools.json/route";
import "./editor-default-actions";
import { listEditorActions } from "./action-registry";
import {
  LIVE_MCP_DYNAMIC_TOOL_REQUESTS,
  LIVE_MCP_REQUEST_TYPES,
  LIVE_MCP_STATIC_TOOL_REQUESTS,
  handleGetAudioActivity,
  handleLiveMcpRequest,
  liveMcpOperatorToolName,
} from "./live-mcp-bridge";
import { listMcpToolDefinitions } from "./mcp-tools";

function names<T extends { name: string }>(items: T[]): string[] {
  return items.map((item) => item.name).sort();
}

async function listServerTools() {
  const engine = new EditorEngine({ project: createProject() });
  const server = createMcutMcpServer({ engine });
  const client = new Client({ name: "mcut-studio-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.listTools();
  } finally {
    await client.close();
    await server.close();
  }
}

function toolsRequest(profile?: string): Request {
  const url = new URL("http://localhost/tools.json");
  if (profile) url.searchParams.set("profile", profile);
  return new Request(url);
}

describe("MCP tool manifest", () => {
  test("/tools.json stays dynamic because it varies by profile query", () => {
    expect(toolsJsonDynamic).toBe("force-dynamic");
  });

  test("/tools.json defaults to the curated agent profile", async () => {
    const operators = registerCoreOperators(createEditorOperatorRegistry()).list();
    const response = toolsJson(toolsRequest());
    const body = (await response.json()) as {
      profile?: string;
      tools?: ReturnType<typeof listMcpToolDefinitions>;
    };
    const tools = body.tools ?? [];
    const toolNames = new Set(tools.map((tool) => tool.name));

    expect(response.status).toBe(200);
    expect(body.profile).toBe("agent");
    expect(tools).toEqual(listMcpToolDefinitions("agent"));
    expect(tools.length).toBe(15);
    expect(toolNames.size).toBe(tools.length);
    for (const name of LIVE_MCP_STATIC_TOOL_REQUESTS) expect(toolNames.has(name)).toBe(true);
    for (const command of listCommands()) expect(toolNames.has(command.type)).toBe(false);
    for (const operator of operators) {
      expect(toolNames.has(liveMcpOperatorToolName(operator.id))).toBe(false);
    }

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: "object" }));
    }
  });

  test("/tools.json?profile=full exposes static tools, operators, and timeline commands", async () => {
    const operators = registerCoreOperators(createEditorOperatorRegistry()).list();
    const response = toolsJson(toolsRequest("full"));
    const body = (await response.json()) as {
      profile?: string;
      tools?: ReturnType<typeof listMcpToolDefinitions>;
    };
    const tools = body.tools ?? [];
    const toolNames = new Set(tools.map((tool) => tool.name));

    expect(body.profile).toBe("full");
    expect(tools).toEqual(listMcpToolDefinitions("full"));
    expect(toolNames.size).toBe(tools.length);
    for (const name of LIVE_MCP_STATIC_TOOL_REQUESTS) expect(toolNames.has(name)).toBe(true);
    for (const operator of operators) {
      expect(toolNames.has(liveMcpOperatorToolName(operator.id))).toBe(true);
    }
    for (const command of listCommands()) expect(toolNames.has(command.type)).toBe(true);

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: "object" }));
    }
  });

  test("/tools.json?profile=commands exposes raw command tools only", async () => {
    const response = toolsJson(toolsRequest("commands"));
    const body = (await response.json()) as {
      profile?: string;
      tools?: ReturnType<typeof listMcpToolDefinitions>;
    };

    expect(body.profile).toBe("commands");
    expect(body.tools).toEqual(listMcpToolDefinitions("commands"));
    expect(names(body.tools ?? [])).toEqual(listCommands().map((command) => command.type).sort());
  });
});

describe("Studio action/operator MCP surface", () => {
  test("published MCP server tools include legacy static tools, operators, and commands", async () => {
    const operators = registerCoreOperators(createEditorOperatorRegistry()).list();
    const result = await listServerTools();
    const toolNames = new Set(result.tools.map((tool) => tool.name));
    const legacyStaticTools = LIVE_MCP_STATIC_TOOL_REQUESTS.filter(
      (name) => name !== "list_commands" && name !== "apply_commands" && name !== "run_operator",
    );

    expect(toolNames.size).toBe(result.tools.length);
    for (const name of legacyStaticTools) expect(toolNames.has(name)).toBe(true);
    for (const command of listCommands()) expect(toolNames.has(command.type)).toBe(true);
    for (const operator of operators) {
      expect(toolNames.has(serverOperatorToolName(operator.id))).toBe(true);
      expect(serverOperatorToolName(operator.id)).toBe(liveMcpOperatorToolName(operator.id));
    }
  });

  test("every operator-backed Studio action points at a registered SDK operator", () => {
    const operators = registerCoreOperators(createEditorOperatorRegistry());
    const operatorIds = new Set(operators.list().map((operator) => operator.id));
    const missing = listEditorActions()
      .filter((action) => action.operator && !operatorIds.has(action.operator.id))
      .map((action) => `${action.id} -> ${action.operator!.id}`);

    expect(missing).toEqual([]);
  });

  test("live bridge lists SDK operators with MCP server-compatible tool names", async () => {
    const engine = new EditorEngine({ project: createProject() });
    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: "test",
      type: "list_operators",
    })) as Array<{ id: string; tool: string }>;

    expect(result.length).toBeGreaterThan(0);
    expect(result.find((operator) => operator.id === "playback.toggle")).toMatchObject({
      tool: "operator_playback_toggle",
    });
    for (const operator of result) {
      expect(operator.tool).toBe(liveMcpOperatorToolName(operator.id));
    }
  });

  test("live bridge applies a command batch in one request", async () => {
    const engine = new EditorEngine({ project: createProject() });
    const trackId = engine.project.tracks[0]!.id;
    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: "test",
      type: "apply_commands",
      payload: {
        commands: [
          {
            type: "addElement",
            trackId,
            element: { id: "e-agent-title", type: "text", startMs: 0, durationMs: 1000, text: "Agent" },
          },
        ],
      },
    })) as { applied: number; summary: string };

    expect(result.applied).toBe(1);
    expect(result.summary).toContain("Agent");
    expect(engine.project.tracks[0]!.elements.map((element) => element.id)).toEqual([
      "e-agent-title",
    ]);
    expect(engine.canUndo()).toBe(true);
  });

  test("live bridge lists agent-focused action schemas", async () => {
    const engine = new EditorEngine({ project: createProject() });
    const actions = (await handleLiveMcpRequest(engine, {} as never, {
      id: "test",
      type: "list_actions",
    })) as Array<{ id: string; description?: string; inputSchema?: Record<string, unknown> }>;

    expect(actions.find((action) => action.id === "transcript.remove-silence")).toMatchObject({
      description: expect.stringContaining("ensure_transcript"),
      inputSchema: expect.objectContaining({ type: "object" }),
    });
    expect(actions.find((action) => action.id === "effects.fade-open-close")).toMatchObject({
      description: expect.stringContaining("fade-in"),
      inputSchema: expect.objectContaining({ type: "object" }),
    });
  });

  test("live bridge removes silence through transcript action without audio analysis", async () => {
    const engine = new EditorEngine({ project: createProject() });
    const videoTrackId = engine.project.tracks[0]!.id;
    engine.dispatch({ type: "addTrack", id: "t-captions", name: "Captions" });
    engine.dispatch({
      type: "addAsset",
      asset: {
        id: "a-video",
        kind: "video",
        src: "blob:video",
        name: "talk.mp4",
        durationMs: 10000,
        width: 1920,
        height: 1080,
      },
    });
    engine.dispatch({
      type: "addElement",
      trackId: videoTrackId,
      element: {
        id: "e-video",
        type: "video",
        assetId: "a-video",
        startMs: 0,
        durationMs: 10000,
        trimStartMs: 0,
      },
    });
    engine.dispatch({
      type: "addElement",
      trackId: "t-captions",
      element: {
        id: "e-caption",
        type: "caption",
        startMs: 0,
        durationMs: 10000,
        text: "hello world",
        words: [
          { text: "hello", startMs: 0, endMs: 3000 },
          { text: "world", startMs: 7000, endMs: 10000 },
        ],
      },
    });

    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: "test",
      type: "run_action",
      payload: {
        actionId: "transcript.remove-silence",
        input: { elementId: "e-video", paddingMs: 0 },
      },
    })) as { removedMs: number; silences: Array<{ startMs: number; endMs: number }> };

    expect(result.removedMs).toBe(4000);
    expect(result.silences).toEqual([{ startMs: 3000, endMs: 7000 }]);
    const elements = engine.project.tracks.find((track) => track.id === videoTrackId)!.elements;
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ id: "e-video", startMs: 0, durationMs: 3000 });
    expect(elements[1]).toMatchObject({ startMs: 3000, trimStartMs: 7000, durationMs: 3000 });
  });

  test("live bridge applies opening and closing fades through preset action", async () => {
    const engine = new EditorEngine({ project: createProject() });
    const trackId = engine.project.tracks[0]!.id;
    engine.dispatch({
      type: "addAsset",
      asset: {
        id: "a-video",
        kind: "video",
        src: "blob:video",
        name: "talk.mp4",
        durationMs: 5000,
        width: 1920,
        height: 1080,
      },
    });
    engine.dispatch({
      type: "addElement",
      trackId,
      element: {
        id: "e-video",
        type: "video",
        assetId: "a-video",
        startMs: 0,
        durationMs: 5000,
        trimStartMs: 0,
      },
    });

    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: "test",
      type: "run_action",
      payload: {
        actionId: "effects.fade-open-close",
        input: { elementId: "e-video", durationMs: 500 },
      },
    })) as { elementId: string; presets: string[]; durationMs: number };
    const element = getElementLocation(engine.project, "e-video")!.element;

    expect(result).toEqual({ elementId: "e-video", durationMs: 500, presets: ["fade-in", "fade-out"] });
    expect("keyframes" in element ? element.keyframes?.opacity : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ timeMs: 0, value: 0 }),
        expect.objectContaining({ timeMs: 500, value: 1 }),
        expect.objectContaining({ timeMs: 4500, value: 1 }),
        expect.objectContaining({ timeMs: 5000, value: 0 }),
      ]),
    );
  });

  test("live bridge returns semantic audio activity windows for a resolved media source", async () => {
    const engine = new EditorEngine({ project: createProject() });
    const trackId = engine.project.tracks[0]!.id;
    engine.dispatch({
      type: "addAsset",
      asset: {
        id: "a-audio",
        kind: "audio",
        src: "blob:audio",
        name: "room.wav",
        durationMs: 3000,
      },
    });
    engine.dispatch({
      type: "addElement",
      trackId,
      element: {
        id: "e-audio",
        type: "audio",
        assetId: "a-audio",
        startMs: 500,
        durationMs: 1000,
        trimStartMs: 1000,
      },
    });

    const result = (await handleGetAudioActivity(
      engine,
      { elementId: "e-audio", includeWaveform: true },
      async (src, options) => {
        expect(src).toBe("blob:audio");
        expect(options).toMatchObject({ startMs: 1000, endMs: 2000, waveformBuckets: 128 });
        return {
          durationMs: 1000,
          soundWindows: [
            { startMs: 0, endMs: 300, durationMs: 300, rms: 0.02, peakRms: 0.03, peakAmplitude: 0.4 },
          ],
          silenceWindows: [
            { startMs: 300, endMs: 1000, durationMs: 700, rms: 0, peakRms: 0, peakAmplitude: 0 },
          ],
          summary: {
            soundMs: 300,
            silenceMs: 700,
            soundFraction: 0.3,
            silenceFraction: 0.7,
            peakRms: 0.03,
            peakAmplitude: 0.4,
          },
          waveform: [0.4, 0.1, 0],
        };
      },
    )) as {
      elementId: string;
      hasAudio: boolean;
      source: { startMs: number; endMs: number };
      soundWindows: Array<{ startMs: number; endMs: number }>;
      silenceWindows: Array<{ startMs: number; endMs: number }>;
      waveform?: number[];
    };

    expect(result.elementId).toBe("e-audio");
    expect(result.hasAudio).toBe(true);
    expect(result.source).toMatchObject({ startMs: 1000, endMs: 2000 });
    expect(result.soundWindows).toEqual([expect.objectContaining({ startMs: 1000, endMs: 1300 })]);
    expect(result.silenceWindows).toEqual([expect.objectContaining({ startMs: 1300, endMs: 2000 })]);
    expect(result.waveform).toEqual([0.4, 0.1, 0]);
  });

  test("live bridge request vocabulary covers MCP static and dynamic browser tools", () => {
    expect(new Set(LIVE_MCP_REQUEST_TYPES).size).toBe(LIVE_MCP_REQUEST_TYPES.length);
    expect(LIVE_MCP_STATIC_TOOL_REQUESTS).toEqual([
      "get_summary",
      "get_project",
      "get_media_context",
      "get_audio_activity",
      "get_transcript",
      "search_transcript",
      "ensure_transcript",
      "list_commands",
      "apply_commands",
      "list_operators",
      "run_operator",
      "list_actions",
      "run_action",
      "undo",
      "redo",
    ]);
    expect(LIVE_MCP_DYNAMIC_TOOL_REQUESTS).toEqual(["dispatch_command"]);
  });
});
