import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, parseProject } from '@mcut/timeline'
import { WebSocket } from 'ws'
import { LiveMcutBridge, createHttpBridgeTarget } from './live-bridge'
import { createMcutMcpServer, createMcutMcpServerForTarget } from './server'

async function connect(engine: EditorEngine, onChange?: () => void) {
  const server = createMcutMcpServer({ engine, onChange })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

describe('createMcutMcpServer', () => {
  test('lists static, operator, and command tools', async () => {
    const client = await connect(new EditorEngine())
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('get_summary')
    expect(names).toContain('get_media_context')
    expect(names).toContain('get_transcript')
    expect(names).toContain('search_transcript')
    expect(names).toContain('ensure_transcript')
    expect(names).toContain('get_audio_activity')
    expect(names).toContain('list_actions')
    expect(names).toContain('run_action')
    expect(names).toContain('splitElement')
    expect(names.some((name) => name.startsWith('operator_'))).toBe(true)
    const split = tools.find((tool) => tool.name === 'splitElement')!
    expect(split.inputSchema.properties).toHaveProperty('atMs')
  })

  test('dispatches commands, reports state, and persists via onChange', async () => {
    const engine = new EditorEngine()
    let persisted = 0
    const client = await connect(engine, () => {
      persisted++
    })

    const added = await client.callTool({
      name: 'addTrack',
      arguments: { name: 'B-roll' },
    })
    expect(added.isError).toBeFalsy()
    expect(persisted).toBe(1)
    expect(engine.project.tracks.some((track) => track.name === 'B-roll')).toBe(true)

    const summary = await client.callTool({ name: 'get_summary', arguments: {} })
    const content = summary.content as Array<{ type: string; text: string }>
    expect(content[0]!.text).toContain('B-roll')

    const undone = await client.callTool({ name: 'undo', arguments: {} })
    expect(undone.isError).toBeFalsy()
    expect(engine.project.tracks.some((track) => track.name === 'B-roll')).toBe(false)
  })

  test('invalid payloads come back as tool errors, not crashes', async () => {
    const client = await connect(new EditorEngine())
    const result = await client.callTool({
      name: 'removeElement',
      arguments: { elementId: 'e-ghost' },
    })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]!.text).toContain('CommandError')
  })

  test('reports media context, transcript, search results, and file-backed transcription limits', async () => {
    const engine = new EditorEngine({
      project: parseProject({
        id: 'p-context',
        name: 'Context',
        width: 1920,
        height: 1080,
        fps: 30,
        assets: {
          'a-video': {
            id: 'a-video',
            kind: 'video',
            src: 'blob:video',
            name: 'talk.mp4',
            durationMs: 4000,
            width: 1920,
            height: 1080,
          },
        },
        tracks: [
          {
            id: 't-video',
            name: 'Video',
            elements: [
              {
                id: 'e-video',
                type: 'video',
                assetId: 'a-video',
                startMs: 0,
                durationMs: 4000,
              },
            ],
          },
          {
            id: 't-captions',
            name: 'Captions',
            elements: [
              {
                id: 'e-caption',
                type: 'caption',
                startMs: 1000,
                durationMs: 900,
                text: 'Hello bridge',
                words: [
                  { text: 'Hello', startMs: 0, endMs: 300 },
                  { text: 'bridge', startMs: 350, endMs: 700 },
                ],
              },
            ],
          },
        ],
      }),
    })
    engine.select(['e-video' as `e-${string}`])
    engine.seek(1200)
    const client = await connect(engine)

    const context = await client.callTool({ name: 'get_media_context', arguments: {} })
    const contextText = (context.content as Array<{ type: string; text: string }>)[0]!.text
    expect(contextText).toContain('"assetCount": 1')
    expect(contextText).toContain('"elementIds": [')
    expect(contextText).toContain('"source"')

    const transcript = await client.callTool({
      name: 'get_transcript',
      arguments: { includeWords: true },
    })
    const transcriptText = (transcript.content as Array<{ type: string; text: string }>)[0]!.text
    expect(transcriptText).toContain('Hello bridge')
    expect(transcriptText).toContain('"startMs": 1000')

    const search = await client.callTool({
      name: 'search_transcript',
      arguments: { query: 'bridge' },
    })
    const searchText = (search.content as Array<{ type: string; text: string }>)[0]!.text
    expect(searchText).toContain('"count": 1')
    expect(searchText).toContain('"text": "bridge"')

    const ensured = await client.callTool({ name: 'ensure_transcript', arguments: {} })
    expect(ensured.isError).toBe(true)
    const ensuredText = (ensured.content as Array<{ type: string; text: string }>)[0]!.text
    expect(ensuredText).toContain('requires a live browser bridge')

    const activity = await client.callTool({ name: 'get_audio_activity', arguments: {} })
    expect(activity.isError).toBe(true)
    const activityText = (activity.content as Array<{ type: string; text: string }>)[0]!.text
    expect(activityText).toContain('requires a live browser bridge')
  })

  test('live bridge forwards MCP tools to a connected browser tab', async () => {
    const bridge = new LiveMcutBridge({ token: 'test-token', requestTimeoutMs: 1000 })
    const port = await bridge.listen(0)
    const server = createMcutMcpServerForTarget({ target: bridge.createTarget() })
    const client = new Client({ name: 'test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const tracks: string[] = []
    const actions: string[] = []
    let transcriptEnsured = false
    const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=test-token`, {
      headers: { Origin: 'http://localhost:3000' },
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as {
        id: string
        type: string
        payload?: { commandName?: string; actionId?: string; input?: { name?: string } }
      }
      if (message.type === 'dispatch_command' && message.payload?.commandName === 'addTrack') {
        tracks.push(message.payload.input?.name ?? 'Track')
        socket.send(JSON.stringify({ id: message.id, ok: true, result: null }))
        return
      }
      if (message.type === 'list_actions') {
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: [{ id: 'edit.add-text', label: 'Add text', enabled: true }],
          }),
        )
        return
      }
      if (message.type === 'run_action') {
        actions.push(message.payload?.actionId ?? 'unknown')
        socket.send(JSON.stringify({ id: message.id, ok: true, result: null }))
        return
      }
      if (message.type === 'get_media_context') {
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: { project: { name: 'Browser project' }, transcript: { hasTranscript: false } },
          }),
        )
        return
      }
      if (message.type === 'get_transcript') {
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: { hasTranscript: true, text: 'Hello browser' },
          }),
        )
        return
      }
      if (message.type === 'search_transcript') {
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: { query: 'Hello', count: 1 },
          }),
        )
        return
      }
      if (message.type === 'ensure_transcript') {
        transcriptEnsured = true
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: { applied: true, transcript: { text: 'Hello browser' } },
          }),
        )
        return
      }
      if (message.type === 'get_audio_activity') {
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: {
              elementId: 'e-video',
              hasAudio: true,
              durationMs: 1000,
              soundWindows: [{ startMs: 0, endMs: 400, durationMs: 400 }],
              silenceWindows: [{ startMs: 400, endMs: 1000, durationMs: 600 }],
              summary: { soundMs: 400, silenceMs: 600, soundFraction: 0.4 },
            },
          }),
        )
        return
      }
      if (message.type === 'get_summary') {
        socket.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: `Tracks: ${tracks.join(', ')}; Actions: ${actions.join(', ')}; Transcript: ${transcriptEnsured}`,
          }),
        )
        return
      }
      socket.send(JSON.stringify({ id: message.id, ok: true, result: null }))
    })

    const result = await client.callTool({
      name: 'addTrack',
      arguments: { name: 'B-roll' },
    })
    expect(result.isError).toBeFalsy()
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]!.text).toContain('B-roll')

    const listed = await client.callTool({ name: 'list_actions', arguments: {} })
    const listedContent = listed.content as Array<{ type: string; text: string }>
    expect(listedContent[0]!.text).toContain('edit.add-text')

    const acted = await client.callTool({
      name: 'run_action',
      arguments: { actionId: 'edit.add-text' },
    })
    expect(acted.isError).toBeFalsy()
    const actedContent = acted.content as Array<{ type: string; text: string }>
    expect(actedContent[0]!.text).toContain('edit.add-text')

    const mediaContext = await client.callTool({ name: 'get_media_context', arguments: {} })
    const mediaContextContent = mediaContext.content as Array<{ type: string; text: string }>
    expect(mediaContextContent[0]!.text).toContain('Browser project')

    const transcript = await client.callTool({
      name: 'get_transcript',
      arguments: { includeWords: true },
    })
    const transcriptContent = transcript.content as Array<{ type: string; text: string }>
    expect(transcriptContent[0]!.text).toContain('Hello browser')

    const searched = await client.callTool({
      name: 'search_transcript',
      arguments: { query: 'Hello' },
    })
    const searchedContent = searched.content as Array<{ type: string; text: string }>
    expect(searchedContent[0]!.text).toContain('"count": 1')

    const ensured = await client.callTool({
      name: 'ensure_transcript',
      arguments: { replace: true },
    })
    expect(ensured.isError).toBeFalsy()
    const ensuredContent = ensured.content as Array<{ type: string; text: string }>
    expect(ensuredContent[0]!.text).toContain('Transcript: true')

    const activity = await client.callTool({
      name: 'get_audio_activity',
      arguments: { elementId: 'e-video' },
    })
    expect(activity.isError).toBeFalsy()
    const activityContent = activity.content as Array<{ type: string; text: string }>
    expect(activityContent[0]!.text).toContain('"soundWindows"')
    expect(activityContent[0]!.text).toContain('"elementId": "e-video"')

    socket.close()
    bridge.close()
  })

  test('live bridge reports fixed-port collisions without crashing', async () => {
    const bridge = new LiveMcutBridge({ token: 'first-token' })
    const port = await bridge.listen(0)
    const collidingBridge = new LiveMcutBridge({ token: 'second-token' })

    try {
      await expect(collidingBridge.listen(port)).rejects.toMatchObject({
        code: 'port-in-use',
      })
    } finally {
      collidingBridge.close()
      bridge.close()
    }
  })

  test('live bridge reports the editor URL when no browser tab is connected', async () => {
    const bridge = new LiveMcutBridge({
      token: 'missing-tab-token',
      editorUrl: 'http://localhost:3000/editor',
      requestTimeoutMs: 1000,
    })
    const port = await bridge.listen(0)

    try {
      await expect(bridge.createTarget().getSummary()).rejects.toThrow(
        `http://localhost:3000/editor?mcpBridge=${port}&mcpToken=missing-tab-token`,
      )
      await expect(bridge.rpc('status')).resolves.toMatchObject({
        connected: false,
        openEditorUrl: `http://localhost:3000/editor?mcpBridge=${port}&mcpToken=missing-tab-token`,
      })
    } finally {
      bridge.close()
    }
  })

  test('daemon HTTP target forwards MCP tools to the live browser tab', async () => {
    const bridge = new LiveMcutBridge({ token: 'daemon-token', requestTimeoutMs: 1000 })
    const port = await bridge.listen(0)
    const server = createMcutMcpServerForTarget({ target: createHttpBridgeTarget(port) })
    const client = new Client({ name: 'test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=daemon-token`, {
      headers: { Origin: 'http://localhost:3000' },
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    let actionRan = false
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { id: string; type: string }
      if (message.type === 'run_action') {
        actionRan = true
        socket.send(JSON.stringify({ id: message.id, ok: true, result: null }))
        return
      }
      if (message.type === 'get_summary') {
        socket.send(JSON.stringify({ id: message.id, ok: true, result: actionRan ? 'action ran' : 'idle' }))
        return
      }
      if (message.type === 'get_transcript') {
        socket.send(JSON.stringify({ id: message.id, ok: true, result: { text: 'daemon transcript' } }))
        return
      }
      socket.send(JSON.stringify({ id: message.id, ok: true, result: null }))
    })

    const result = await client.callTool({
      name: 'run_action',
      arguments: { actionId: 'view.reset-layout' },
    })
    expect(result.isError).toBeFalsy()
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]!.text).toContain('action ran')

    const transcript = await client.callTool({ name: 'get_transcript', arguments: {} })
    const transcriptContent = transcript.content as Array<{ type: string; text: string }>
    expect(transcriptContent[0]!.text).toContain('daemon transcript')

    socket.close()
    bridge.close()
  })

  test('live bridge exposes MCP over Streamable HTTP', async () => {
    const bridge = new LiveMcutBridge({ token: 'http-token', requestTimeoutMs: 1000 })
    const port = await bridge.listen(0)
    const client = new Client({ name: 'test', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?token=http-token`))

    const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=http-token`, {
      headers: { Origin: 'http://localhost:3000' },
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { id: string; type: string }
      if (message.type === 'get_summary') {
        socket.send(JSON.stringify({ id: message.id, ok: true, result: 'HTTP MCP summary' }))
        return
      }
      socket.send(JSON.stringify({ id: message.id, ok: true, result: null }))
    })

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name)).toContain('get_summary')

      const result = await client.callTool({ name: 'get_summary', arguments: {} })
      expect(result.isError).toBeFalsy()
      const content = result.content as Array<{ type: string; text: string }>
      expect(content[0]!.text).toContain('HTTP MCP summary')
    } finally {
      await client.close()
      socket.close()
      bridge.close()
    }
  })

  test('live bridge rejects browser sockets without the configured token', async () => {
    const bridge = new LiveMcutBridge({ token: 'required-token', requestTimeoutMs: 1000 })
    const port = await bridge.listen(0)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp`, {
      headers: { Origin: 'http://localhost:3000' },
    })
    socket.on('error', () => {
      // Expected: the bridge rejects the unauthenticated WebSocket upgrade.
    })

    const result = await new Promise<'open' | 'closed'>((resolve) => {
      socket.once('open', () => resolve('open'))
      socket.once('close', () => resolve('closed'))
    })

    expect(result).toBe('closed')
    bridge.close()
  })
})
