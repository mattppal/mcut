import { describe, expect, test } from 'bun:test'
import { operatorIds, type OperatorId } from '@mcut/editor'
import { createMcutMcpServer, operatorToolName as serverOperatorToolName } from '@mcut/mcp-server'
import { MCP_AGENT_TOOL_DEFINITIONS, MCP_BRIDGE_ONLY_TOOL_NAMES, listServerToolDefinitions } from '@mcut/mcp-server/contract'
import { EditorEngine, createProject, getElementLocation, listCommands } from '@mcut/timeline'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { GET as toolsCommandsJson } from '../../app/tools.commands.json/route'
import { GET as toolsFullJson } from '../../app/tools.full.json/route'
import { GET as toolsJson } from '../../app/tools.json/route'
import './editor-default-actions'
import {
  LIVE_MCP_DYNAMIC_TOOL_REQUESTS,
  LIVE_MCP_REQUEST_TYPES,
  LIVE_MCP_STATIC_TOOL_REQUESTS,
  handleGetAudioActivity,
  handleLiveMcpRequest,
  liveMcpOperatorToolName,
} from './live-mcp-bridge'
import { listMcpToolDefinitions } from './mcp-tools'

function names<T extends { name: string }>(items: T[]): string[] {
  return items.map((item) => item.name).sort()
}

async function listServerTools() {
  const engine = new EditorEngine({ project: createProject() })
  const server = createMcutMcpServer({ engine })
  const client = new Client({ name: 'mcut-studio-test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    return await client.listTools()
  } finally {
    await client.close()
    await server.close()
  }
}

describe('MCP tool manifest', () => {
  test('/tools.json serves the curated agent profile', async () => {
    const response = toolsJson()
    const body = (await response.json()) as {
      profile?: string
      tools?: ReturnType<typeof listMcpToolDefinitions>
    }
    const tools = body.tools ?? []
    const toolNames = new Set(tools.map((tool) => tool.name))

    expect(response.status).toBe(200)
    expect(body.profile).toBe('agent')
    expect(tools).toEqual(listMcpToolDefinitions('agent'))
    expect(tools).toEqual(JSON.parse(JSON.stringify(MCP_AGENT_TOOL_DEFINITIONS)))
    expect(tools.length, '23 server static tools + 3 bridge-only tools (list_commands, apply_commands, run_operator)').toBe(26)
    expect(toolNames.size).toBe(tools.length)
    for (const name of LIVE_MCP_STATIC_TOOL_REQUESTS) expect(toolNames.has(name)).toBe(true)
    for (const command of listCommands()) expect(toolNames.has(command.type)).toBe(false)
    for (const id of operatorIds) expect(toolNames.has(liveMcpOperatorToolName(id))).toBe(false)

    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: 'object' }))
    }
  })

  test('/tools.full.json exposes static tools, operators, and timeline commands', async () => {
    const response = toolsFullJson()
    const body = (await response.json()) as {
      profile?: string
      tools?: ReturnType<typeof listMcpToolDefinitions>
    }
    const tools = body.tools ?? []
    const toolNames = new Set(tools.map((tool) => tool.name))

    expect(body.profile).toBe('full')
    expect(tools).toEqual(listMcpToolDefinitions('full'))
    expect(tools.length, '26 agent tools + 42 editor operators + 62 timeline commands').toBe(130)
    expect(toolNames.size).toBe(tools.length)
    for (const name of LIVE_MCP_STATIC_TOOL_REQUESTS) expect(toolNames.has(name)).toBe(true)
    for (const id of operatorIds) expect(toolNames.has(liveMcpOperatorToolName(id))).toBe(true)
    for (const command of listCommands()) expect(toolNames.has(command.type)).toBe(true)

    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: 'object' }))
    }
  })

  test('/tools.commands.json exposes raw command tools only', async () => {
    const response = toolsCommandsJson()
    const body = (await response.json()) as {
      profile?: string
      tools?: ReturnType<typeof listMcpToolDefinitions>
    }

    expect(body.profile).toBe('commands')
    expect(body.tools).toEqual(listMcpToolDefinitions('commands'))
    expect(names(body.tools ?? [])).toEqual(
      listCommands()
        .map((command) => command.type)
        .sort(),
    )
  })
})

describe('Studio action/operator MCP surface', () => {
  test('published MCP server tools deep-equal the shared contract surface', async () => {
    const result = await listServerTools()
    const expected = listServerToolDefinitions()

    expect(JSON.parse(JSON.stringify(result.tools))).toEqual(JSON.parse(JSON.stringify(expected)))

    const serverNames = new Set(result.tools.map((tool) => tool.name))
    const bridgeOnly = new Set<string>(MCP_BRIDGE_ONLY_TOOL_NAMES)
    for (const name of LIVE_MCP_STATIC_TOOL_REQUESTS) {
      expect(bridgeOnly.has(name) || serverNames.has(name)).toBe(true)
    }
    expect([...bridgeOnly].filter((name) => serverNames.has(name))).toEqual([])
    for (const id of operatorIds) expect(serverOperatorToolName(id)).toBe(liveMcpOperatorToolName(id))
  })

  test('live bridge lists SDK operators with MCP server-compatible tool names', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: 'test',
      type: 'list_operators',
    })) as Array<{ id: OperatorId; tool: string }>

    expect(result.length).toBe(operatorIds.length)
    expect(result.find((operator) => operator.id === 'playback.toggle')).toMatchObject({
      tool: 'operator_playback_toggle',
    })
    for (const operator of result) {
      expect(operator.tool).toBe(liveMcpOperatorToolName(operator.id))
    }
  })

  test('live bridge applies a command batch in one request', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const trackId = engine.project.tracks[0]!.id
    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: 'test',
      type: 'apply_commands',
      payload: {
        commands: [
          {
            type: 'addElement',
            trackId,
            element: { id: 'e-agent-title', type: 'text', startMs: 0, durationMs: 1000, text: 'Agent' },
          },
        ],
      },
    })) as { applied: number; summary: string }

    expect(result.applied).toBe(1)
    expect(result.summary).toContain('Agent')
    expect(engine.project.tracks[0]!.elements.map((element) => element.id)).toEqual(['e-agent-title'])
    expect(engine.canUndo()).toBe(true)
  })

  test('live bridge lists agent-focused action schemas', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const actions = (await handleLiveMcpRequest(engine, {} as never, {
      id: 'test',
      type: 'list_actions',
    })) as Array<{ id: string; description?: string; inputSchema?: Record<string, unknown> }>

    expect(actions.find((action) => action.id === 'transcript.remove-silence')).toMatchObject({
      description: expect.stringContaining('ensure_transcript'),
      inputSchema: expect.objectContaining({ type: 'object' }),
    })
    expect(actions.find((action) => action.id === 'effects.fade-open-close')).toMatchObject({
      description: expect.stringContaining('fade-in'),
      inputSchema: expect.objectContaining({ type: 'object' }),
    })
  })

  test('live bridge removes silence through transcript action without audio analysis', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const videoTrackId = engine.project.tracks[0]!.id
    engine.dispatch({ type: 'addTrack', id: 't-captions', name: 'Captions' })
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-video',
        kind: 'video',
        src: 'blob:video',
        name: 'talk.mp4',
        durationMs: 10000,
        width: 1920,
        height: 1080,
      },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: videoTrackId,
      element: {
        id: 'e-video',
        type: 'video',
        assetId: 'a-video',
        startMs: 0,
        durationMs: 10000,
        trimStartMs: 0,
      },
    })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-captions',
      element: {
        id: 'e-caption',
        type: 'caption',
        startMs: 0,
        durationMs: 10000,
        text: 'hello world',
        words: [
          { text: 'hello', startMs: 0, endMs: 3000 },
          { text: 'world', startMs: 7000, endMs: 10000 },
        ],
      },
    })

    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: 'test',
      type: 'run_action',
      payload: {
        actionId: 'transcript.remove-silence',
        input: { elementId: 'e-video', paddingMs: 0 },
      },
    })) as { removedMs: number; silences: Array<{ startMs: number; endMs: number }> }

    expect(result.removedMs).toBe(4000)
    expect(result.silences).toEqual([{ startMs: 3000, endMs: 7000 }])
    const elements = engine.project.tracks.find((track) => track.id === videoTrackId)!.elements
    expect(elements).toHaveLength(2)
    expect(elements[0]).toMatchObject({ id: 'e-video', startMs: 0, durationMs: 3000 })
    expect(elements[1]).toMatchObject({ startMs: 3000, trimStartMs: 7000, durationMs: 3000 })
  })

  test('live bridge applies opening and closing fades through preset action', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const trackId = engine.project.tracks[0]!.id
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-video',
        kind: 'video',
        src: 'blob:video',
        name: 'talk.mp4',
        durationMs: 5000,
        width: 1920,
        height: 1080,
      },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: {
        id: 'e-video',
        type: 'video',
        assetId: 'a-video',
        startMs: 0,
        durationMs: 5000,
        trimStartMs: 0,
      },
    })

    const result = (await handleLiveMcpRequest(engine, {} as never, {
      id: 'test',
      type: 'run_action',
      payload: {
        actionId: 'effects.fade-open-close',
        input: { elementId: 'e-video', durationMs: 500 },
      },
    })) as { elementId: string; presets: string[]; durationMs: number }
    const element = getElementLocation(engine.project, 'e-video')!.element

    expect(result).toEqual({ elementId: 'e-video', durationMs: 500, presets: ['fade-in', 'fade-out'] })
    expect('keyframes' in element ? element.keyframes?.opacity : undefined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ timeMs: 0, value: 0 }),
        expect.objectContaining({ timeMs: 500, value: 1 }),
        expect.objectContaining({ timeMs: 4500, value: 1 }),
        expect.objectContaining({ timeMs: 5000, value: 0 }),
      ]),
    )
  })

  test('live bridge returns semantic audio activity windows for a resolved media source', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const trackId = engine.project.tracks[0]!.id
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-audio',
        kind: 'audio',
        src: 'blob:audio',
        name: 'room.wav',
        durationMs: 3000,
      },
    })
    engine.dispatch({
      type: 'addElement',
      trackId,
      element: {
        id: 'e-audio',
        type: 'audio',
        assetId: 'a-audio',
        startMs: 500,
        durationMs: 1000,
        trimStartMs: 1000,
      },
    })

    const result = (await handleGetAudioActivity(engine, { elementId: 'e-audio', includeWaveform: true }, async (src, options) => {
      expect(src).toBe('blob:audio')
      expect(options).toMatchObject({ startMs: 1000, endMs: 2000, waveformBuckets: 128 })
      return {
        durationMs: 1000,
        soundWindows: [{ startMs: 0, endMs: 300, durationMs: 300, rms: 0.02, peakRms: 0.03, peakAmplitude: 0.4 }],
        silenceWindows: [{ startMs: 300, endMs: 1000, durationMs: 700, rms: 0, peakRms: 0, peakAmplitude: 0 }],
        summary: {
          soundMs: 300,
          silenceMs: 700,
          soundFraction: 0.3,
          silenceFraction: 0.7,
          peakRms: 0.03,
          peakAmplitude: 0.4,
        },
        waveform: [0.4, 0.1, 0],
      }
    })) as {
      elementId: string
      hasAudio: boolean
      source: { startMs: number; endMs: number }
      soundWindows: Array<{ startMs: number; endMs: number }>
      silenceWindows: Array<{ startMs: number; endMs: number }>
      waveform?: number[]
    }

    expect(result.elementId).toBe('e-audio')
    expect(result.hasAudio).toBe(true)
    expect(result.source).toMatchObject({ startMs: 1000, endMs: 2000 })
    expect(result.soundWindows).toEqual([expect.objectContaining({ startMs: 1000, endMs: 1300 })])
    expect(result.silenceWindows).toEqual([expect.objectContaining({ startMs: 1300, endMs: 2000 })])
    expect(result.waveform).toEqual([0.4, 0.1, 0])
  })

  test('live bridge request vocabulary covers MCP static and dynamic browser tools', () => {
    expect(new Set(LIVE_MCP_REQUEST_TYPES).size).toBe(LIVE_MCP_REQUEST_TYPES.length)
    expect(LIVE_MCP_STATIC_TOOL_REQUESTS).toEqual([
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
      'list_zooms',
      'edit_zooms',
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
    ])
    expect(LIVE_MCP_DYNAMIC_TOOL_REQUESTS).toEqual(['dispatch_command'])
  })
})
