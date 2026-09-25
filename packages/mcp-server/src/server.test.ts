import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, getProjectCaptions, parseProject } from '@mcut/timeline'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { listServerToolDefinitions } from './contract'
import { LiveMcutBridge, createHttpBridgeTarget } from './live-bridge'
import { createMcutMcpServer, createMcutMcpServerForTarget, type McutMcpTarget } from './server'

async function connect(engine: EditorEngine, onChange?: () => void) {
  const server = createMcutMcpServer({ engine, onChange })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

async function connectTarget(target: McutMcpTarget) {
  const server = createMcutMcpServerForTarget({ target })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function frameTarget(frame: unknown): McutMcpTarget {
  const unused = async (): Promise<unknown> => {
    throw new Error('unused')
  }
  return {
    getSummary: async () => 'unused',
    getProject: () => ({}),
    listActions: () => [],
    listOperators: () => [],
    runAction: unused,
    undo: async () => false,
    redo: async () => false,
    runOperator: unused,
    dispatchCommand: unused,
    applyCommands: unused,
    transact: unused,
    getFrame: async () => frame,
    getContactSheet: async () => frame,
  }
}

function contentText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = 'content' in result && Array.isArray(result.content) ? result.content : []
  const first = content[0]
  return first?.type === 'text' ? first.text : ''
}

const talkProject = () =>
  parseProject({
    id: 'p-talk',
    name: 'Talk',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      'a-video': {
        id: 'a-video',
        kind: 'video',
        src: 'blob:video',
        name: 'talk.mp4',
        durationMs: 10000,
        width: 1920,
        height: 1080,
      },
    },
    tracks: [
      {
        id: 't-video',
        name: 'Video',
        elements: [{ id: 'e-video', type: 'video', assetId: 'a-video', startMs: 0, durationMs: 10000 }],
      },
    ],
  })

const talkTranscript = {
  text: 'hello world',
  words: [
    { text: 'hello', startMs: 0, endMs: 3000 },
    { text: 'world', startMs: 7000, endMs: 10000 },
  ],
  segments: [],
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
    expect(names).toContain('get_frame')
    expect(names).toContain('center_person')
    expect(names).toContain('get_audio_activity')
    expect(names).toContain('apply_captions')
    expect(names).toContain('apply_silence_cuts')
    expect(names).toContain('lint_project')
    expect(names).toContain('list_presets')
    expect(names).toContain('list_actions')
    expect(names).toContain('run_action')
    expect(names).toContain('splitElement')
    expect(names).toContain('operator_playback_toggle')
    const split = tools.find((tool) => tool.name === 'splitElement')!
    expect(split.inputSchema.properties).toHaveProperty('atMs')
    const captions = tools.find((tool) => tool.name === 'apply_captions')
    expect(captions?.inputSchema.properties).toHaveProperty('transcript')
    expect(captions?.inputSchema.properties).toHaveProperty('styleId')
  })

  test('the wire surface deep-equals the shared contract', async () => {
    const client = await connect(new EditorEngine())
    const { tools } = await client.listTools()
    const expected = listServerToolDefinitions()
    expect(JSON.parse(JSON.stringify(tools))).toEqual(JSON.parse(JSON.stringify(expected)))
  })

  test('lints, lists presets, and applies silence cuts and captions from one transcript', async () => {
    const engine = new EditorEngine({ project: talkProject() })
    let persisted = 0
    const client = await connect(engine, () => {
      persisted++
    })

    const presets = await client.callTool({ name: 'list_presets', arguments: {} })
    expect(contentText(presets)).toContain('"id": "youtube"')

    const clean = await client.callTool({ name: 'lint_project', arguments: {} })
    expect(JSON.parse(contentText(clean))).toEqual([])

    const cuts = await client.callTool({
      name: 'apply_silence_cuts',
      arguments: { elementId: 'e-video', transcript: talkTranscript, paddingMs: 0 },
    })
    expect(cuts.isError).toBeFalsy()
    expect(contentText(cuts)).toContain('"removedMs": 4000')
    expect(persisted).toBe(1)
    expect(engine.project.tracks[0]?.elements).toEqual([
      expect.objectContaining({ id: 'e-video', startMs: 0, durationMs: 3000 }),
      expect.objectContaining({ startMs: 3000, trimStartMs: 7000, durationMs: 3000 }),
    ])

    const captions = await client.callTool({
      name: 'apply_captions',
      arguments: { transcript: talkTranscript, styleId: 'classic' },
    })
    expect(captions.isError).toBeFalsy()
    expect(contentText(captions)).toContain('OK: 2 caption(s) applied.')
    expect(persisted).toBe(2)
    expect(getProjectCaptions(engine.project).map((ref) => ref.caption.text)).toEqual(['hello', 'world'])

    const linted = await client.callTool({ name: 'lint_project', arguments: {} })
    expect(JSON.parse(contentText(linted))).toEqual([])

    expect(engine.undo()).toBe(true)
    expect(getProjectCaptions(engine.project)).toEqual([])

    const rejected = await client.callTool({
      name: 'apply_silence_cuts',
      arguments: { elementId: 'video', transcript: talkTranscript },
    })
    expect(rejected.isError).toBe(true)
    expect(contentText(rejected)).toContain('elementId')
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

  test('transact applies two animation presets as one undo step', async () => {
    const engine = new EditorEngine({ project: talkProject() })
    let persisted = 0
    const client = await connect(engine, () => {
      persisted++
    })
    const before = JSON.parse(JSON.stringify(engine.toJSON()))

    const applied = await client.callTool({
      name: 'transact',
      arguments: {
        calls: [
          { name: 'applyAnimationPreset', arguments: { elementId: 'e-video', preset: 'fade-in' } },
          { name: 'applyAnimationPreset', arguments: { elementId: 'e-video', preset: 'fade-out' } },
        ],
      },
    })
    expect(applied.isError).toBeFalsy()
    expect(contentText(applied).startsWith('OK: 2 calls applied as one undo step.\n\nResult:\n[\n  null,\n  null\n]')).toBe(true)
    expect(persisted).toBe(1)
    const clip = engine.project.tracks[0]?.elements[0]
    if (clip === undefined || clip.type !== 'video') throw new Error('fixture lost the video clip')
    expect(clip.keyframes).toEqual({
      opacity: [
        { timeMs: 0, value: 0, easing: { cubicBezier: [0.33, 1, 0.68, 1] } },
        { timeMs: 300, value: 1 },
        { timeMs: 9750, value: 1, easing: { cubicBezier: [0.32, 0, 0.67, 0] } },
        { timeMs: 10000, value: 0 },
      ],
    })
    expect(engine.canUndo()).toBe(true)
    expect(engine.canRedo()).toBe(false)

    const undone = await client.callTool({ name: 'undo', arguments: {} })
    expect(undone.isError).toBeFalsy()
    expect(contentText(undone).startsWith('Undone.')).toBe(true)
    expect(JSON.parse(JSON.stringify(engine.toJSON()))).toEqual(before)
    expect(engine.canUndo()).toBe(false)
    expect(engine.canRedo()).toBe(true)
  })

  test('a failing transact call leaves the project and the undo stack unchanged', async () => {
    const engine = new EditorEngine({ project: talkProject() })
    let persisted = 0
    const client = await connect(engine, () => {
      persisted++
    })
    const before = JSON.parse(JSON.stringify(engine.toJSON()))

    const failed = await client.callTool({
      name: 'transact',
      arguments: {
        calls: [
          { name: 'applyAnimationPreset', arguments: { elementId: 'e-video', preset: 'fade-in' } },
          { name: 'applyAnimationPreset', arguments: { elementId: 'e-missing', preset: 'fade-out' } },
        ],
      },
    })
    expect(failed.isError).toBe(true)
    expect(contentText(failed)).toBe('transact call 2 (applyAnimationPreset) failed: no element "e-missing". No changes were applied.')
    expect(JSON.parse(JSON.stringify(engine.toJSON()))).toEqual(before)
    expect(engine.canUndo()).toBe(false)
    expect(engine.canRedo()).toBe(false)
    expect(persisted).toBe(0)

    const undone = await client.callTool({ name: 'undo', arguments: {} })
    expect(undone.isError).toBe(true)
    expect(contentText(undone)).toBe('Nothing to undo.')
    expect(JSON.parse(JSON.stringify(engine.toJSON()))).toEqual(before)
  })

  test('a rejected edit_zooms batch leaves the project and the undo stack unchanged', async () => {
    const engine = new EditorEngine({ project: talkProject() })
    const client = await connect(engine)
    const before = JSON.parse(JSON.stringify(engine.toJSON()))

    const failed = await client.callTool({
      name: 'edit_zooms',
      arguments: {
        edits: [
          { type: 'addZoomRegion', elementId: 'e-video', zoom: { id: 'z-open', atMs: 0 } },
          { type: 'addZoomRegion', elementId: 'e-video', zoom: { id: 'z-clash', atMs: 1000 } },
        ],
      },
    })
    expect(failed.isError).toBe(true)
    expect(contentText(failed)).toContain('zooms "z-open" and "z-clash" overlap on the same target')
    expect(JSON.parse(JSON.stringify(engine.toJSON()))).toEqual(before)
    expect(engine.canUndo()).toBe(false)
  })

  test('transact rejects a disallowed tool before it changes the project', async () => {
    const engine = new EditorEngine({ project: talkProject() })
    let persisted = 0
    const client = await connect(engine, () => {
      persisted++
    })
    const before = JSON.parse(JSON.stringify(engine.toJSON()))

    const rejected = await client.callTool({
      name: 'transact',
      arguments: {
        calls: [{ name: 'applyAnimationPreset', arguments: { elementId: 'e-video', preset: 'fade-in' } }, { name: 'undo' }],
      },
    })
    expect(rejected.isError).toBe(true)
    expect(contentText(rejected)).toBe(
      'transact cannot run "undo". Allowed tools are timeline commands (list_commands), operator_* tools, run_operator, run_action, and apply_commands.',
    )
    expect(JSON.parse(JSON.stringify(engine.toJSON()))).toEqual(before)
    expect(engine.canUndo()).toBe(false)
    expect(engine.canRedo()).toBe(false)
    expect(persisted).toBe(0)
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

  test('static tool arguments are parsed before the handler runs', async () => {
    const client = await connect(new EditorEngine())

    const wrongType = await client.callTool({
      name: 'search_transcript',
      arguments: { query: 42 },
    })
    expect(wrongType.isError).toBe(true)
    expect(wrongType.content).toEqual([
      {
        type: 'text',
        text: 'search_transcript: ✖ Invalid input: expected string, received number\n  → at arguments.query',
      },
    ])

    const unknownKey = await client.callTool({
      name: 'get_transcript',
      arguments: { includeWords: true, words: true },
    })
    expect(unknownKey.isError).toBe(true)
    expect(unknownKey.content).toEqual([{ type: 'text', text: 'get_transcript: ✖ Unrecognized key: "words"\n  → at arguments' }])

    const badId = await client.callTool({
      name: 'ensure_transcript',
      arguments: { elementId: 'clip-1' },
    })
    expect(badId.isError).toBe(true)
    expect(badId.content).toEqual([
      {
        type: 'text',
        text: 'ensure_transcript: ✖ invalid element id (expected "e-..." prefix)\n  → at arguments.elementId',
      },
    ])
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

    const frame = await client.callTool({ name: 'get_frame', arguments: { timeMs: 0 } })
    expect(frame.isError).toBe(true)
    expect(contentText(frame)).toBe('get_frame requires the live bridge connected to Studio.')
    const changes = await client.callTool({ name: 'find_scene_changes', arguments: {} })
    expect(changes.isError).toBe(true)
    expect(contentText(changes)).toBe('find_scene_changes requires the live bridge connected to Studio.')
    const centered = await client.callTool({ name: 'center_person', arguments: {} })
    expect(centered.isError).toBe(true)
    expect(contentText(centered)).toBe('center_person requires a live browser bridge connected to an editor tab.')
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

  test('live bridge forwards center_person with its defaults and waits past the request timeout', async () => {
    const bridge = new LiveMcutBridge({ token: 'center-token', requestTimeoutMs: 50, transcriptionTimeoutMs: 2000 })
    const port = await bridge.listen(0)
    const server = createMcutMcpServerForTarget({ target: bridge.createTarget() })
    const client = new Client({ name: 'test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=center-token`, {
      headers: { Origin: 'http://localhost:3000' },
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    const tabRequestSchema = z.object({ id: z.string(), type: z.string(), payload: z.unknown() })
    const payloads: unknown[] = []
    socket.on('message', (raw) => {
      const message = tabRequestSchema.parse(JSON.parse(raw.toString()))
      if (message.type === 'center_person') {
        payloads.push(message.payload)
        setTimeout(() => socket.send(JSON.stringify({ id: message.id, ok: true, result: { keys: 4 } })), 200)
        return
      }
      socket.send(JSON.stringify({ id: message.id, ok: true, result: message.type === 'get_summary' ? 'Centered summary' : null }))
    })

    try {
      const centered = await client.callTool({ name: 'center_person', arguments: { elementId: 'e-multicam', source: 'camera' } })

      expect(contentText(centered)).toBe('OK: person centered.\n\nResult:\n{\n  "keys": 4\n}\n\nCentered summary')
      expect(payloads).toEqual([{ elementId: 'e-multicam', source: 'camera', aspect: 9 / 16, smoothing: 0.5 }])
    } finally {
      socket.close()
      bridge.close()
    }
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

  test('live bridge waits for a browser tab to reconnect before failing a request', async () => {
    const bridge = new LiveMcutBridge({
      token: 'reconnect-token',
      requestTimeoutMs: 1000,
      reconnectGraceMs: 1000,
    })
    const port = await bridge.listen(0)

    try {
      const summary = bridge.createTarget().getSummary()
      await new Promise((resolve) => setTimeout(resolve, 10))

      const socket = new WebSocket(`ws://127.0.0.1:${port}/mcut-mcp?token=reconnect-token`, {
        headers: { Origin: 'http://localhost:3000' },
      })
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { id: string; type: string }
        if (message.type === 'get_summary') {
          socket.send(JSON.stringify({ id: message.id, ok: true, result: 'reconnected summary' }))
        }
      })
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })

      await expect(summary).resolves.toBe('reconnected summary')
      socket.close()
    } finally {
      bridge.close()
    }
  })

  test('live bridge /status lists only connection state when no browser tab is connected', async () => {
    const bridge = new LiveMcutBridge({
      token: 'missing-tab-token',
      editorUrl: 'http://localhost:3000/editor',
      reconnectGraceMs: 20,
    })
    const port = await bridge.listen(0)

    try {
      await expect(bridge.createTarget().getSummary()).rejects.toThrow(
        'No mcut editor is connected to the live bridge. Open mcut Studio, or run `bun dev` in the repository.',
      )
      const body = await (await fetch(`http://127.0.0.1:${port}/status`)).json()
      expect(body).toEqual({ ok: true, result: { connected: false, tab: null } })
    } finally {
      bridge.close()
    }
  })

  test('daemon HTTP target forwards MCP tools to the live browser tab', async () => {
    const bridge = new LiveMcutBridge({ token: 'daemon-token', requestTimeoutMs: 1000 })
    const port = await bridge.listen(0)
    const server = createMcutMcpServerForTarget({ target: createHttpBridgeTarget(port, 'daemon-token') })
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
      if (message.type === 'center_person') {
        socket.send(JSON.stringify({ id: message.id, ok: true, result: { keys: 2 } }))
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

    const centered = await client.callTool({ name: 'center_person', arguments: {} })
    expect(contentText(centered)).toContain('"keys": 2')

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
    const ignoreRejectedUpgrade = () => {}
    socket.on('error', ignoreRejectedUpgrade)

    const result = await new Promise<'open' | 'closed'>((resolve) => {
      socket.once('open', () => resolve('open'))
      socket.once('close', () => resolve('closed'))
    })

    expect(result).toBe('closed')
    bridge.close()
  })

  test('get_frame returns the target PNG as image content', async () => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const client = await connectTarget(
      frameTarget({
        mimeType: 'image/png',
        data,
        width: 8,
        height: 4,
        timeMs: 1000,
        elementId: 'e-video',
        visibleElementIds: ['e-video'],
      }),
    )
    const result = await client.callTool({ name: 'get_frame', arguments: { timeMs: 1000 } })
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([
      { type: 'image', data, mimeType: 'image/png' },
      {
        type: 'text',
        text: '{"timeMs":1000,"width":8,"height":4,"elementId":"e-video","visibleElementIds":["e-video"]}',
      },
    ])
  })
  test('get_contact_sheet returns the sheet PNG and its tile times', async () => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const sheet = {
      mimeType: 'image/png',
      data,
      width: 652,
      height: 188,
      columns: 2,
      elementId: 'e-multicam',
      source: 'screen',
      tiles: [{ timeMs: 0 }, { timeMs: 45000 }],
    }
    const client = await connectTarget(frameTarget(sheet))
    const result = await client.callTool({ name: 'get_contact_sheet', arguments: { timesMs: [0, 45000] } })
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([
      { type: 'image', data, mimeType: 'image/png' },
      { type: 'text', text: '{"width":652,"height":188,"columns":2,"elementId":"e-multicam","source":"screen","tiles":[{"timeMs":0},{"timeMs":45000}]}' },
    ])
  })
})
