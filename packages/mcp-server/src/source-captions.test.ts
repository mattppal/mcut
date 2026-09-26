import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject, getProjectTranscript, resolveElementAudioSource, type ElementId } from '@mcut/timeline'
import { z } from 'zod'
import { createMcutMcpServer } from './server'

const words = Array.from({ length: 36 }, (_, i) => ({ text: `w${i}`, startMs: 2000 + i * 500, endMs: 2000 + i * 500 + (i === 6 ? 0 : 300) }))
const transcript = { words }

function multicam(): EditorEngine {
  const engine = new EditorEngine({ project: createProject({ id: 'p-mc', width: 1280, height: 720 }) })
  engine.dispatch({ type: 'addTrack', id: 't-mic' })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'media/screen.mp4', durationMs: 60000, width: 1280, height: 720 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'media/mic.wav', durationMs: 60000 } })
  engine.dispatch({ type: 'addElement', trackId: 't-default', element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 1000, durationMs: 20000, trimStartMs: 0 } })
  engine.dispatch({ type: 'addElement', trackId: 't-mic', element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 1000, durationMs: 20000, trimStartMs: 1800 } })
  engine.dispatch({ type: 'createMulticam', sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }], multicamId: 'e-mc' })
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

function captionWords(engine: EditorEngine): Map<string, number> {
  const placed = getProjectTranscript(engine.project, { includeWords: true }).captions.flatMap((caption) => caption.words ?? [])
  return new Map(placed.map((word) => [word.text, word.startMs]))
}

function expectedWords(engine: EditorEngine, pieceIds: readonly ElementId[]): Map<string, number> {
  const expected = new Map<string, number>()
  for (const id of pieceIds) {
    const piece = resolveElementAudioSource(engine.project, id)
    if (!piece) throw new Error(`no audio source for ${id}`)
    for (const word of words) {
      if (word.startMs >= piece.sourceStartMs && word.startMs < piece.sourceEndMs) {
        expected.set(word.text, word.startMs - piece.sourceStartMs + piece.timelineStartMs)
      }
    }
  }
  return expected
}

const retakesReplySchema = z.object({ transcript: z.object({ words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })) }) })

async function cutRetakes(): Promise<{ engine: EditorEngine; client: Client; saved: z.infer<typeof retakesReplySchema>['transcript'] }> {
  const engine = multicam()
  const client = await connect(engine)
  await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
  const saved = retakesReplySchema.parse(JSON.parse(textOf(await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-mc' } })))).transcript
  engine.dispatch({ type: 'splitElement', elementId: 'e-mc', atMs: 5000, rightElementId: 'e-cut-1' })
  engine.dispatch({ type: 'splitElement', elementId: 'e-cut-1', atMs: 7200, rightElementId: 'e-keep-2' })
  engine.dispatch({ type: 'splitElement', elementId: 'e-keep-2', atMs: 11000, rightElementId: 'e-cut-2' })
  engine.dispatch({ type: 'splitElement', elementId: 'e-cut-2', atMs: 13600, rightElementId: 'e-keep-3' })
  engine.dispatch({ type: 'rippleDelete', elementIds: ['e-cut-2', 'e-cut-1'] })
  return { engine, client, saved }
}

describe('apply_captions with a source scope', () => {
  test('one call with the find_retakes transcript re-captions every piece of a cut multicam, each kept word within 250 ms of its timeline position', async () => {
    const { engine, client, saved } = await cutRetakes()
    const stale = captionWords(engine)
    expect(saved.words).toHaveLength(words.length)

    const result = await client.callTool({ name: 'apply_captions', arguments: { transcript: saved, elementId: 'e-keep-2' } })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('over 3 piece(s) of this source (e-mc, e-keep-2, e-keep-3)')

    const expected = expectedWords(engine, ['e-mc', 'e-keep-2', 'e-keep-3'])
    const placed = captionWords(engine)
    expect([...placed.keys()].sort()).toEqual([...expected.keys()].sort())
    for (const [text, timelineMs] of expected) {
      expect(Math.abs((placed.get(text) ?? Number.NaN) - timelineMs)).toBeLessThanOrEqual(250)
    }

    expect(engine.undo()).toBe(true)
    expect(captionWords(engine)).toEqual(stale)
  })

  test('a transcript slice replaces only the pieces it has words for', async () => {
    const { engine, client } = await cutRetakes()
    await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
    const lastPiece = expectedWords(engine, ['e-keep-3'])
    const slice = { words: words.filter((word) => lastPiece.has(word.text)) }

    await client.callTool({ name: 'apply_captions', arguments: { transcript: slice, elementId: 'e-keep-3' } })
    expect(captionWords(engine)).toEqual(expectedWords(engine, ['e-mc', 'e-keep-2', 'e-keep-3']))
  })

  test('scope clip captions only the named piece', async () => {
    const { engine, client } = await cutRetakes()
    await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-keep-2', scope: 'clip' } })
    expect(captionWords(engine)).toEqual(expectedWords(engine, ['e-keep-2']))
  })
})
