import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { applyCommands } from '@mcut/editor'
import { EditorEngine, createProject, getProjectCaptions, getProjectTranscript, resolveElementAudioSource, type ElementId } from '@mcut/timeline'
import { buildCaptionsCommand } from '@mcut/transcription'
import { z } from 'zod'
import { createMcutMcpServer, createMcutMcpServerForTarget, type McutMcpTarget } from './server'
import { StoredTranscripts } from './stored-transcripts'

const words = Array.from({ length: 36 }, (_, i) => ({ text: `w${i}`, startMs: 2000 + i * 500, endMs: 2000 + i * 500 + (i === 6 ? 0 : 300) }))
const transcript = { words }

function multicam(): EditorEngine {
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

function expectedWords(engine: EditorEngine, pieceIds: readonly ElementId[], spoken: readonly (typeof words)[number][] = words): Map<string, number> {
  const expected = new Map<string, number>()
  for (const id of pieceIds) {
    const piece = resolveElementAudioSource(engine.project, id)
    if (!piece) throw new Error(`no audio source for ${id}`)
    for (const word of spoken) {
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
  cutTwoRetakes(engine)
  return { engine, client, saved }
}

function cutTwoRetakes(engine: EditorEngine): void {
  engine.dispatch({ type: 'splitElement', elementId: 'e-mc', atMs: 5000, rightElementId: 'e-cut-1' })
  engine.dispatch({ type: 'splitElement', elementId: 'e-cut-1', atMs: 7200, rightElementId: 'e-keep-2' })
  engine.dispatch({ type: 'splitElement', elementId: 'e-keep-2', atMs: 11000, rightElementId: 'e-cut-2' })
  engine.dispatch({ type: 'splitElement', elementId: 'e-cut-2', atMs: 13600, rightElementId: 'e-keep-3' })
  engine.dispatch({ type: 'rippleDelete', elementIds: ['e-cut-2', 'e-cut-1'] })
}

function expectEveryPieceInSync(engine: EditorEngine): void {
  const expected = expectedWords(engine, ['e-mc', 'e-keep-2', 'e-keep-3'])
  const placed = captionWords(engine)
  expect([...placed.keys()].sort()).toEqual([...expected.keys()].sort())
  for (const [text, timelineMs] of expected) {
    expect(Math.abs((placed.get(text) ?? Number.NaN) - timelineMs)).toBeLessThanOrEqual(250)
  }
}

async function connectTarget(engine: EditorEngine, transcripts: StoredTranscripts): Promise<Client> {
  const server = createMcutMcpServerForTarget({ target: transcribingTarget(engine), transcripts })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function transcribingTarget(engine: EditorEngine): McutMcpTarget {
  return {
    getSummary: () => '',
    getProject: () => engine.toJSON(),
    listActions: () => [],
    listOperators: () => [],
    runAction: () => undefined,
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    runOperator: () => undefined,
    dispatchCommand: () => undefined,
    applyCommands: (commands) => applyCommands(engine, commands),
    ensureTranscript: () => {
      engine.dispatch(buildCaptionsCommand(engine.project, { text: '', words, segments: [] }, { elementId: 'e-mc' }))
      return { applied: true, source: { elementId: 'e-mc' } }
    },
  }
}

describe('apply_captions with a source scope', () => {
  test('one call with the find_retakes transcript re-captions every piece of a cut multicam, each kept word within 250 ms of its timeline position', async () => {
    const { engine, client, saved } = await cutRetakes()
    const stale = captionWords(engine)
    expect(saved.words).toHaveLength(words.length)

    const result = await client.callTool({ name: 'apply_captions', arguments: { transcript: saved, elementId: 'e-keep-2' } })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('over 3 piece(s) of this source (e-mc, e-keep-2, e-keep-3)')
    expectEveryPieceInSync(engine)

    expect(engine.undo()).toBe(true)
    expect(captionWords(engine)).toEqual(stale)
  })

  test('after cuts, apply_captions with only elementId reuses the transcript find_retakes stored, across per-request servers, and captions every piece in sync', async () => {
    const engine = multicam()
    await (await connect(engine)).callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
    const transcripts = new StoredTranscripts()
    await (await connectTarget(engine, transcripts)).callTool({ name: 'find_retakes', arguments: { elementId: 'e-mc' } })
    cutTwoRetakes(engine)

    const result = await (await connectTarget(engine, transcripts)).callTool({ name: 'apply_captions', arguments: { elementId: 'e-keep-3' } })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('over 3 piece(s) of this source (e-mc, e-keep-2, e-keep-3)')
    expectEveryPieceInSync(engine)
  })

  test('apply_captions with the full transcript, one retake cut, then apply_captions with only elementId, when a word starts before the one ahead of it', async () => {
    const engine = multicam()
    const client = await connect(engine)
    const whisper = words.map((word, i) => (i === 20 ? { ...word, startMs: words[19].startMs - 100 } : word))
    await client.callTool({ name: 'apply_captions', arguments: { transcript: { words: whisper }, elementId: 'e-mc' } })
    engine.dispatch({ type: 'splitElement', elementId: 'e-mc', atMs: 5000, rightElementId: 'e-cut' })
    engine.dispatch({ type: 'splitElement', elementId: 'e-cut', atMs: 7200, rightElementId: 'e-keep' })
    engine.dispatch({ type: 'rippleDelete', elementIds: ['e-cut'] })

    const result = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-keep', replace: true } })
    expect(textOf(result)).toContain('over 2 piece(s) of this source (e-mc, e-keep)')
    const placed = captionWords(engine)
    const expected = expectedWords(engine, ['e-mc', 'e-keep'], whisper)
    const spokenOrder = getProjectTranscript(engine.project, { includeWords: true }).captions.flatMap((caption) => caption.words ?? []).map((word) => word.text)
    expect(spokenOrder).toEqual(whisper.map((word) => word.text).filter((text) => expected.has(text)))
    for (const [text, timelineMs] of expected) {
      expect(Math.abs((placed.get(text) ?? Number.NaN) - timelineMs)).toBeLessThanOrEqual(250)
    }
  })

  test('the transcript ensure_transcript applied is reused after cuts', async () => {
    const engine = multicam()
    const client = await connectTarget(engine, new StoredTranscripts())
    await client.callTool({ name: 'ensure_transcript', arguments: {} })
    cutTwoRetakes(engine)

    const result = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-keep-2' } })
    expect(result.isError).toBeFalsy()
    expectEveryPieceInSync(engine)
  })

  test('the transcript an earlier apply_captions passed is reused after cuts, and a slice keeps the rest of it', async () => {
    const engine = multicam()
    const client = await connect(engine)
    await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
    cutTwoRetakes(engine)
    await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
    const lastPiece = expectedWords(engine, ['e-keep-3'])
    const slice = await client.callTool({
      name: 'apply_captions',
      arguments: { transcript: { words: words.filter((word) => lastPiece.has(word.text)) }, elementId: 'e-keep-3' },
    })
    expect(slice.isError).toBeFalsy()
    for (const { caption } of getProjectCaptions(engine.project)) engine.dispatch({ type: 'removeElement', elementId: caption.id })

    const result = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-keep-2' } })
    expect(result.isError).toBeFalsy()
    expect(captionWords(engine)).toEqual(expectedWords(engine, ['e-mc', 'e-keep-2', 'e-keep-3']))
  })

  test('find_retakes after the cut stores nothing, so apply_captions without a transcript fails instead of placing words off sync', async () => {
    const engine = multicam()
    await (await connect(engine)).callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
    cutTwoRetakes(engine)
    const client = await connect(engine)
    await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-keep-2' } })

    const result = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-keep-2' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('no stored transcript')
  })

  test('a stored transcript that an undo took off the timeline is refused', async () => {
    const engine = multicam()
    const client = await connect(engine)
    await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
    const wrong = { words: words.map((word) => ({ ...word, text: `x${word.text}` })) }
    await client.callTool({ name: 'apply_captions', arguments: { transcript: wrong, elementId: 'e-mc' } })
    expect(engine.undo()).toBe(true)
    cutTwoRetakes(engine)

    const result = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-keep-2' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('does not match the captions')
  })

  test('a transcript slice replaces only the pieces it has words for', async () => {
    const { engine, client } = await cutRetakes()
    await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-mc' } })
    const lastPiece = expectedWords(engine, ['e-keep-3'])
    const slice = { words: words.filter((word) => lastPiece.has(word.text)) }

    await client.callTool({ name: 'apply_captions', arguments: { transcript: slice, elementId: 'e-keep-3' } })
    expect(captionWords(engine)).toEqual(expectedWords(engine, ['e-mc', 'e-keep-2', 'e-keep-3']))
  })

  test('captions on another caption track stay', async () => {
    const { engine, client, saved } = await cutRetakes()
    engine.dispatch({ type: 'addTrack', id: 't-guest' })
    engine.dispatch({ type: 'addElement', trackId: 't-guest', element: { id: 'e-guest', type: 'caption', startMs: 2000, durationMs: 1000, text: 'guest' } })

    await client.callTool({ name: 'apply_captions', arguments: { transcript: saved, elementId: 'e-mc' } })
    expect(engine.project.tracks.find((track) => track.id === 't-guest')?.elements.map((element) => element.id)).toEqual(['e-guest'])
    expect(captionWords(engine)).toEqual(expectedWords(engine, ['e-mc', 'e-keep-2', 'e-keep-3']))
  })

  test('scope clip captions only the named piece', async () => {
    const { engine, client } = await cutRetakes()
    await client.callTool({ name: 'apply_captions', arguments: { transcript, elementId: 'e-keep-2', scope: 'clip' } })
    expect(captionWords(engine)).toEqual(expectedWords(engine, ['e-keep-2']))
  })
})
