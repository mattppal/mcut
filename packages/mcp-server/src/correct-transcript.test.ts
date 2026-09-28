import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject, getProjectCaptions, getProjectTranscript } from '@mcut/timeline'
import { retypeCaption } from '@mcut/transcription'
import { createMcutMcpServer } from './server'

function talkingHead(): EditorEngine {
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

const misheard = [...spoken('Yesterday afternoon we asked Grok Bot to write the intro.', 4000), ...spoken('Then Grok Bot wrote the outro too.', 9000)]

const placedWords = (engine: EditorEngine) => getProjectTranscript(engine.project, { includeWords: true }).captions.flatMap((caption) => caption.words ?? [])

const spokenText = (engine: EditorEngine) =>
  placedWords(engine)
    .map((word) => word.text)
    .join(' ')

async function captioned(): Promise<{ engine: EditorEngine; client: Client }> {
  const engine = talkingHead()
  const client = await connect(engine)
  await client.callTool({ name: 'apply_captions', arguments: { transcript: { words: misheard }, elementId: 'e-talk' } })
  return { engine, client }
}

describe('correct_transcript', () => {
  test('fixes a misheard name in every caption, including one split across two captions, keeping word timings, as one undo step', async () => {
    const { engine, client } = await captioned()
    const before = placedWords(engine)
    expect(getProjectCaptions(engine.project).map(({ caption }) => caption.text)).toContain('Yesterday afternoon we asked Grok')

    const result = await client.callTool({ name: 'correct_transcript', arguments: { find: 'grok bot', replace: 'Grokbot' } })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('replaced 2 match(es)')
    expect(spokenText(engine)).toBe('Yesterday afternoon we asked Grokbot to write the intro. Then Grokbot wrote the outro too.')
    const fixed = placedWords(engine).filter((word) => word.text === 'Grokbot')
    expect(fixed.map((word) => [word.startMs, word.endMs])).toEqual([
      [6200, 6750],
      [10_300, 10_850],
    ])
    const captions = getProjectCaptions(engine.project).map(({ caption }) => caption)
    for (const [i, caption] of captions.entries()) {
      const next = captions[i + 1]
      if (next) expect(caption.startMs + caption.durationMs).toBeLessThanOrEqual(next.startMs)
    }

    expect(textOf(await client.callTool({ name: 'undo', arguments: {} }))).toContain('Undone')
    expect(placedWords(engine)).toEqual(before)
  })

  test('also fixes the stored transcript, so captions rebuilt from it keep the correction', async () => {
    const { engine, client } = await captioned()
    await client.callTool({ name: 'correct_transcript', arguments: { find: 'Grok Bot', replace: 'Grokbot' } })
    for (const { caption } of getProjectCaptions(engine.project)) engine.dispatch({ type: 'removeElement', elementId: caption.id })

    const rebuilt = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-talk' } })
    expect(rebuilt.isError).toBeFalsy()
    expect(spokenText(engine)).toBe('Yesterday afternoon we asked Grokbot to write the intro. Then Grokbot wrote the outro too.')
  })

  test('a caption retyped in Studio carries into captions rebuilt after a cut', async () => {
    const { engine, client } = await captioned()
    const last = getProjectCaptions(engine.project).at(-1)?.caption
    if (!last) throw new Error('no captions')
    const patch = retypeCaption(last, last.text.replace('Grok Bot', 'Grokbot'))
    engine.dispatch({ type: 'updateElement', elementId: last.id, patch: { text: patch.text, words: patch.words ?? [] } })
    const cut = await client.callTool({ name: 'remove_ranges', arguments: { ranges: [{ startMs: 8000, endMs: 9500 }] } })
    expect(cut.isError).toBeFalsy()

    const rebuilt = await client.callTool({ name: 'apply_captions', arguments: { elementId: 'e-talk', replace: true } })
    expect(rebuilt.isError).toBeFalsy()
    expect(spokenText(engine)).toContain('Then Grokbot wrote the outro too.')
  })

  test('reports a spelling that matches nothing instead of claiming success', async () => {
    const { client } = await captioned()
    const result = await client.callTool({ name: 'correct_transcript', arguments: { find: 'Grock Bot', replace: 'Grokbot' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('search_transcript')
  })
})
