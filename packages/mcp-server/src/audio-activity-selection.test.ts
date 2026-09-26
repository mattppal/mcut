import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject, getElement } from '@mcut/timeline'
import { createMcutMcpServer } from './server'

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = 'content' in result && Array.isArray(result.content) ? result.content : []
  const first = content[0]
  return first?.type === 'text' ? first.text : ''
}

async function connect(engine: EditorEngine): Promise<Client> {
  const server = createMcutMcpServer({ engine })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function multicamBesideMusic(withAudio: boolean): EditorEngine {
  const engine = new EditorEngine({ project: createProject({ width: 1280, height: 720 }) })
  engine.dispatch({ type: 'addTrack', id: 't-mic' })
  engine.dispatch({ type: 'addTrack', id: 't-music' })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 60000, width: 1280, height: 720 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'blob:mic', durationMs: 60000 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-music', kind: 'audio', src: 'blob:music', durationMs: 60000 } })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 4000, trimStartMs: 0 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-mic',
    element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 0, durationMs: 4000, trimStartMs: 250 },
  })
  engine.dispatch({
    type: 'createMulticam',
    sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }],
    multicamId: 'e-mc',
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-music',
    element: { id: 'e-music', type: 'audio', assetId: 'a-music', startMs: 0, durationMs: 8000, trimStartMs: 0 },
  })
  if (!withAudio) engine.dispatch({ type: 'setMulticamAudio', elementId: 'e-mc', sourceKey: null })
  return engine
}

describe('get_audio_activity selection', () => {
  test('a selected multicam with no audio source rejects, and the music clip is untouched', async () => {
    const engine = multicamBesideMusic(false)
    engine.select(['e-mc'])
    const client = await connect(engine)

    const activity = await client.callTool({ name: 'get_audio_activity', arguments: {} })
    expect(textOf(activity)).toBe('Element "e-mc" has no audio source. Set one with setMulticamAudio.')
    expect(getElement(engine.project, 'e-music')).toMatchObject({ id: 'e-music', startMs: 0, durationMs: 8000, trimStartMs: 0 })
    expect(getElement(engine.project, 'e-mc')).toMatchObject({ id: 'e-mc', startMs: 0, durationMs: 4000, trimStartMs: 0 })
  })

  test('a selected multicam with an audio source is the headless target', async () => {
    const engine = multicamBesideMusic(true)
    engine.select(['e-mc'])
    const client = await connect(engine)

    const activity = await client.callTool({ name: 'get_audio_activity', arguments: {} })
    expect(textOf(activity)).toBe(
      'get_audio_activity requires a live browser bridge connected to an editor tab. Resolved element e-mc asset a-mic source 250-4250ms.',
    )
    expect(getElement(engine.project, 'e-music')).toMatchObject({ id: 'e-music', startMs: 0, durationMs: 8000, trimStartMs: 0 })
  })

  test('with nothing selected, a silent multicam falls through to the music clip', async () => {
    const engine = multicamBesideMusic(false)
    engine.select([])
    const client = await connect(engine)

    const activity = await client.callTool({ name: 'get_audio_activity', arguments: {} })
    expect(textOf(activity)).toBe(
      'get_audio_activity requires a live browser bridge connected to an editor tab. Resolved element e-music asset a-music source 0-8000ms.',
    )
  })
})
