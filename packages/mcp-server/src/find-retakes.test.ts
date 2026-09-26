import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject, getProjectTranscript } from '@mcut/timeline'
import { z } from 'zod'
import { createMcutMcpServer } from './server'

const replySchema = z.object({
  candidates: z.array(z.object({ startMs: z.number(), endMs: z.number() })),
  transcript: z.object({ words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })) }),
})

function trimmedClip(): EditorEngine {
  const engine = new EditorEngine({ project: createProject({ width: 1280, height: 720 }) })
  const trackId = engine.project.tracks[0]?.id ?? 't-default'
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-talk', kind: 'video', src: 'blob:t', durationMs: 60_000, width: 1280, height: 720 } })
  engine.dispatch({
    type: 'addElement',
    trackId,
    element: { type: 'video', id: 'e-talk', assetId: 'a-talk', startMs: 3000, durationMs: 20_000, trimStartMs: 2000 },
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

const spoken = (line: string, fromMs: number) => line.split(' ').map((text, i) => ({ text, startMs: fromMs + i * 300, endMs: fromMs + i * 300 + 250 }))

describe('find_retakes with elementId', () => {
  test('returns the clip transcript in source ms, so re-captioning a moved and trimmed clip lands on the same words', async () => {
    const engine = trimmedClip()
    const client = await connect(engine)

    const sourceWords = [...spoken('Every morning there is a page on my desk.', 4000), ...spoken('every morning there is a page on my printer.', 9000)]
    await client.callTool({ name: 'apply_captions', arguments: { transcript: { words: sourceWords }, elementId: 'e-talk' } })
    const before = getProjectTranscript(engine.project, { includeWords: true }).captions.flatMap((c) => c.words ?? [])

    const reply = replySchema.parse(JSON.parse(textOf(await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-talk' } }))))
    expect(reply.candidates.map((c) => [c.startMs, c.endMs])).toEqual([[5000, 10_000]])
    expect(reply.transcript.words.map((w) => w.startMs)).toEqual(sourceWords.map((w) => w.startMs))

    await client.callTool({ name: 'apply_captions', arguments: { transcript: reply.transcript, elementId: 'e-talk', replace: true } })
    const after = getProjectTranscript(engine.project, { includeWords: true }).captions.flatMap((c) => c.words ?? [])
    expect(after.map((w) => [w.text, w.startMs])).toEqual(before.map((w) => [w.text, w.startMs]))
  })

  test('rejects a time-remapped clip before any cut, since apply_captions cannot rebuild its captions', async () => {
    const engine = trimmedClip()
    const client = await connect(engine)
    await client.callTool({
      name: 'apply_captions',
      arguments: { transcript: { words: spoken('Every morning there is a page on my desk.', 4000) }, elementId: 'e-talk' },
    })
    engine.dispatch({ type: 'setElementSpeed', elementId: 'e-talk', speed: 2 })

    const result = await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-talk' } })
    expect(textOf(result)).toBe('CommandError (invalid-payload): clip "e-talk" has a time remap, so apply_captions cannot rebuild its captions')
  })
})

const fullTranscript = {
  words: [
    { text: 'hello', startMs: 2000, endMs: 2300 },
    { text: 'there', startMs: 3000, endMs: 3300 },
    { text: 'um', startMs: 6000, endMs: 6300 },
    { text: 'world', startMs: 12000, endMs: 12300 },
  ],
}

function multicamWithOffsetMic(): EditorEngine {
  const engine = new EditorEngine({ project: createProject({ id: 'p-mc', width: 1280, height: 720 }) })
  engine.dispatch({ type: 'addTrack', id: 't-mic' })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'media/screen.mp4', durationMs: 60000, width: 1280, height: 720 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'media/mic.wav', durationMs: 60000 } })
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
  engine.dispatch({
    type: 'createMulticam',
    sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }],
    multicamId: 'e-mc',
  })
  return engine
}

function wordTimes(engine: EditorEngine): Array<[string, number, number]> {
  return getProjectTranscript(engine.project, { includeWords: true })
    .captions.flatMap((caption) => caption.words ?? [])
    .map((word) => [word.text, word.startMs, word.endMs])
}

describe('find_retakes on a cut multicam', () => {
  test('maps each remaining piece into the offset audio asset, and the full transcript captions those words at their original timeline times', async () => {
    const engine = multicamWithOffsetMic()
    const client = await connect(engine)
    await client.callTool({ name: 'apply_captions', arguments: { transcript: fullTranscript, elementId: 'e-mc' } })
    expect(wordTimes(engine)).toEqual([
      ['hello', 1200, 1500],
      ['there', 2200, 2500],
      ['um', 5200, 5500],
      ['world', 11200, 11500],
    ])

    engine.dispatch({ type: 'splitElement', elementId: 'e-mc', atMs: 10000, rightElementId: 'e-right' })
    engine.dispatch({ type: 'splitElement', elementId: 'e-mc', atMs: 4000, rightElementId: 'e-mid' })
    engine.dispatch({ type: 'removeElement', elementId: 'e-mid' })

    const left = replySchema.parse(JSON.parse(textOf(await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-mc' } }))))
    const right = replySchema.parse(JSON.parse(textOf(await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-right' } }))))
    expect(left.transcript.words).toEqual([
      { text: 'hello', startMs: 2000, endMs: 2300 },
      { text: 'there', startMs: 3000, endMs: 3300 },
    ])
    expect(right.transcript.words).toEqual([{ text: 'world', startMs: 12000, endMs: 12300 }])

    await client.callTool({ name: 'apply_captions', arguments: { transcript: fullTranscript, elementId: 'e-mc' } })
    expect(wordTimes(engine)).toEqual([
      ['hello', 1200, 1500],
      ['there', 2200, 2500],
      ['world', 11200, 11500],
    ])
  })

  test('a reversed multicam is rejected', async () => {
    const engine = multicamWithOffsetMic()
    const client = await connect(engine)
    await client.callTool({ name: 'apply_captions', arguments: { transcript: fullTranscript, elementId: 'e-mc' } })
    engine.dispatch({ type: 'updateElement', elementId: 'e-mc', patch: { reversed: true } })

    const result = await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-mc' } })
    expect(textOf(result)).toBe('CommandError (invalid-payload): clip "e-mc" plays reversed, so its captions have no forward source time')
  })

  test('a multicam with no audio source points at setMulticamAudio', async () => {
    const engine = multicamWithOffsetMic()
    const client = await connect(engine)
    await client.callTool({ name: 'apply_captions', arguments: { transcript: fullTranscript, elementId: 'e-mc' } })
    engine.dispatch({ type: 'setMulticamAudio', elementId: 'e-mc', sourceKey: null })

    const result = await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-mc' } })
    expect(textOf(result)).toBe('CommandError (invalid-payload): element "e-mc" has no audio source; set one with setMulticamAudio')
  })
})
