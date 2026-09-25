import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject, getProjectTranscript } from '@mcut/timeline'
import { z } from 'zod'
import { createMcutMcpServer } from './server'

const replySchema = z.object({ transcript: z.object({ words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })) }) })

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

const spoken = (line: string, fromMs: number) => line.split(' ').map((text, i) => ({ text, startMs: fromMs + i * 300, endMs: fromMs + i * 300 + 250 }))

describe('find_retakes with elementId', () => {
  test('returns the clip transcript in source ms, so re-captioning a moved and trimmed clip lands on the same words', async () => {
    const engine = trimmedClip()
    const server = createMcutMcpServer({ engine })
    const client = new Client({ name: 'test', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const sourceWords = [...spoken('Every morning there is a page on my desk.', 4000), ...spoken('every morning there is a page on my printer.', 9000)]
    await client.callTool({ name: 'apply_captions', arguments: { transcript: { words: sourceWords }, elementId: 'e-talk' } })
    const before = getProjectTranscript(engine.project, { includeWords: true }).captions.flatMap((c) => c.words ?? [])

    const result = await client.callTool({ name: 'find_retakes', arguments: { elementId: 'e-talk' } })
    const content = 'content' in result && Array.isArray(result.content) ? result.content : []
    const first = content[0]
    const reply = replySchema.parse(JSON.parse(first?.type === 'text' ? first.text : '{}'))
    expect(reply.transcript.words.map((w) => w.startMs)).toEqual(sourceWords.map((w) => w.startMs))

    await client.callTool({ name: 'apply_captions', arguments: { transcript: reply.transcript, elementId: 'e-talk', replace: true } })
    const after = getProjectTranscript(engine.project, { includeWords: true }).captions.flatMap((c) => c.words ?? [])
    expect(after.map((w) => [w.text, w.startMs])).toEqual(before.map((w) => [w.text, w.startMs]))
  })
})
