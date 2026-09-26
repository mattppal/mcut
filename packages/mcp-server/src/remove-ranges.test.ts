import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject, getProjectTranscript, isMediaClip, resolveElementAudioSource, type Project } from '@mcut/timeline'
import { createMcutMcpServer } from './server'

const words = Array.from({ length: 38 }, (_, i) => ({ text: `w${i}`, startMs: 2000 + i * 500, endMs: 2000 + i * 500 + 300 }))

function multicamWithMusic(): EditorEngine {
  const engine = new EditorEngine({ project: createProject({ id: 'p-mc', width: 1280, height: 720 }) })
  engine.dispatch({ type: 'addTrack', id: 't-mic' })
  engine.dispatch({ type: 'addTrack', id: 't-music' })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'media/screen.mp4', durationMs: 60000, width: 1280, height: 720 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'media/mic.wav', durationMs: 60000 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-music', kind: 'audio', src: 'media/music.wav', durationMs: 60000 } })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 1000, durationMs: 20000, trimStartMs: 0 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-mic',
    element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 1000, durationMs: 20000, trimStartMs: 1800 },
  })
  engine.dispatch({ type: 'createMulticam', sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }], multicamId: 'e-mc' })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-music',
    element: { id: 'e-music', type: 'audio', assetId: 'a-music', startMs: 1000, durationMs: 20000, trimStartMs: 0 },
  })
  return engine
}

async function connect(engine: EditorEngine): Promise<Client> {
  const server = createMcutMcpServer({ engine })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = 'content' in result && Array.isArray(result.content) ? result.content : []
  const first = content[0]
  return first?.type === 'text' ? first.text : ''
}

function spans(project: Project, assetId: string): Array<[number, number, number]> {
  return project.tracks
    .flatMap((track) => track.elements)
    .filter((element) => isMediaClip(element))
    .flatMap((element) => {
      const source = resolveElementAudioSource(project, element.id)
      return source && source.assetId === assetId ? [[source.timelineStartMs, source.sourceStartMs, source.sourceEndMs] satisfies [number, number, number]] : []
    })
    .sort((a, b) => a[0] - b[0])
}

function expectCaptionsInSync(project: Project): void {
  const pieces = spans(project, 'a-mic')
  const expected = new Map<string, number>()
  for (const [timelineStartMs, sourceStartMs, sourceEndMs] of pieces) {
    for (const word of words) {
      if (word.startMs >= sourceStartMs && word.startMs < sourceEndMs) expected.set(word.text, word.startMs - sourceStartMs + timelineStartMs)
    }
  }
  const placed = new Map(
    getProjectTranscript(project, { includeWords: true }).captions.flatMap((caption) => (caption.words ?? []).map((word) => [word.text, word.startMs])),
  )
  expect([...placed.keys()].sort()).toEqual([...expected.keys()].sort())
  for (const [text, timelineMs] of expected) expect(Math.abs((placed.get(text) ?? Number.NaN) - timelineMs)).toBeLessThanOrEqual(1)
}

const retakes = [
  { startMs: 15000, endMs: 15600, abandonedText: 'w25 w26' },
  { startMs: 10000, endMs: 12000, abandonedText: 'w15 w16 w17' },
  { startMs: 6000, endMs: 7500, abandonedText: 'w8 w9' },
  { startMs: 3000, endMs: 4000, abandonedText: 'w2 w3' },
] as const

const keptMicSpans: Array<[number, number, number]> = [
  [1000, 1800, 3800],
  [3000, 4800, 6800],
  [5000, 8300, 10800],
  [7500, 12800, 15800],
  [10500, 16400, 21800],
]

describe('remove_ranges', () => {
  test('cuts 4 find_retakes ranges from a multicam and every track under it in one undo step, then apply_captions re-captions in sync', async () => {
    const engine = multicamWithMusic()
    const client = await connect(engine)
    await client.callTool({ name: 'apply_captions', arguments: { transcript: { words }, elementId: 'e-mc' } })
    const before = engine.toJSON()

    const result = await client.callTool({ name: 'remove_ranges', arguments: { ranges: [retakes[1], retakes[3], retakes[0], retakes[2]] } })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('from 21000ms to 15900ms')

    expect(spans(engine.project, 'a-mic')).toEqual(keptMicSpans)
    expect(spans(engine.project, 'a-music').map(([start, sourceStart, sourceEnd]) => [start, sourceStart + 1800, sourceEnd + 1800])).toEqual(keptMicSpans)
    expectCaptionsInSync(engine.project)

    const recaptioned = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-mc', replace: true } })
    expect(recaptioned.isError).toBeFalsy()
    expect(textOf(recaptioned)).toContain('over 5 piece(s) of this source')
    expectCaptionsInSync(engine.project)

    expect(engine.undo()).toBe(true)
    expect(engine.undo()).toBe(true)
    expect(engine.toJSON()).toEqual(before)
  })

  test('inside transact, remove_ranges cuts the same spans and the whole transact undoes in one step', async () => {
    const engine = multicamWithMusic()
    const client = await connect(engine)
    const before = engine.toJSON()

    const result = await client.callTool({
      name: 'transact',
      arguments: {
        calls: [
          { name: 'remove_ranges', arguments: { ranges: [retakes[1], retakes[3], retakes[0], retakes[2]] } },
          { name: 'addMarker', arguments: { id: 'm-cut', timeMs: 500 } },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    expect(spans(engine.project, 'a-mic')).toEqual(keptMicSpans)
    expect(engine.project.markers.map((marker) => marker.id)).toEqual(['m-cut'])

    expect(engine.undo()).toBe(true)
    expect(engine.toJSON()).toEqual(before)
  })

  test('inside transact, remove_ranges with source time fails before anything changes', async () => {
    const engine = multicamWithMusic()
    const before = engine.toJSON()
    const result = await (
      await connect(engine)
    ).callTool({
      name: 'transact',
      arguments: { calls: [{ name: 'remove_ranges', arguments: { time: 'source', elementId: 'e-mc', ranges: [retakes[0]] } }] },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('timeline ranges only')
    expect(engine.toJSON()).toEqual(before)
  })

  test('source ranges map through every piece that plays them after an earlier cut', async () => {
    const engine = multicamWithMusic()
    const client = await connect(engine)
    await client.callTool({ name: 'remove_ranges', arguments: { ranges: [retakes[3]] } })

    const result = await client.callTool({
      name: 'remove_ranges',
      arguments: {
        time: 'source',
        elementId: 'e-mc',
        ranges: [retakes[0], retakes[1], retakes[2]].map((r) => ({ startMs: r.startMs + 800, endMs: r.endMs + 800 })),
      },
    })
    expect(result.isError).toBeFalsy()
    expect(spans(engine.project, 'a-mic')).toEqual(keptMicSpans)
  })

  test('elementId with timeline ranges fails instead of being read as source time', async () => {
    const engine = multicamWithMusic()
    const before = engine.toJSON()
    const result = await (await connect(engine)).callTool({ name: 'remove_ranges', arguments: { elementId: 'e-mc', ranges: [retakes[0]] } })
    expect(result.isError).toBe(true)
    expect(engine.toJSON()).toEqual(before)
  })

  test('a source range no piece plays fails and changes nothing', async () => {
    const engine = multicamWithMusic()
    const client = await connect(engine)
    const before = engine.toJSON()
    const result = await client.callTool({
      name: 'remove_ranges',
      arguments: { time: 'source', elementId: 'e-mc', ranges: [{ startMs: 40000, endMs: 41000 }] },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('not played by any piece')
    expect(engine.toJSON()).toEqual(before)
  })
})
