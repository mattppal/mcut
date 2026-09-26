import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, createProject, getProjectTranscript } from '@mcut/timeline'
import { createMcutMcpServer } from './server'

const transcript = {
  words: [
    { text: 'alpha', startMs: 0, endMs: 200 },
    { text: 'bravo', startMs: 400, endMs: 600 },
    { text: 'charlie', startMs: 2000, endMs: 2200 },
    { text: 'delta', startMs: 2400, endMs: 2600 },
    { text: 'echo', startMs: 5000, endMs: 5200 },
    { text: 'foxtrot', startMs: 5400, endMs: 5600 },
  ],
}

const unrelated = {
  words: [
    { text: 'quartz', startMs: 0, endMs: 200 },
    { text: 'xylophone', startMs: 400, endMs: 600 },
  ],
}

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

function wordTimes(engine: EditorEngine): Array<[string, number]> {
  return getProjectTranscript(engine.project, { includeWords: true })
    .captions.flatMap((caption) => caption.words ?? [])
    .map((word) => [word.text, word.startMs])
}

async function projectWithGappedCaptions(): Promise<{ engine: EditorEngine; client: Client }> {
  const engine = new EditorEngine({ project: createProject({ width: 1280, height: 720 }) })
  const client = await connect(engine)
  await client.callTool({ name: 'apply_captions', arguments: { transcript } })
  const middle = engine.project.tracks.flatMap((track) => track.elements).find((element) => element.type === 'caption' && element.text === 'charlie delta')
  if (!middle) throw new Error('missing middle caption')
  engine.dispatch({ type: 'removeElement', elementId: middle.id })
  return { engine, client }
}

describe('apply_captions transcript match', () => {
  test('the same transcript re-applied after a cut matches', async () => {
    const { engine, client } = await projectWithGappedCaptions()
    expect(wordTimes(engine)).toEqual([
      ['alpha', 0],
      ['bravo', 400],
      ['echo', 5000],
      ['foxtrot', 5400],
    ])

    const again = await client.callTool({ name: 'apply_captions', arguments: { transcript, replace: true } })
    const againText = textOf(again)
    expect(againText).toContain('The transcript matches captions already in the project.')
    expect(againText).not.toContain('this transcript does not match any transcript in the project')
    expect(wordTimes(engine)).toEqual([
      ['alpha', 0],
      ['bravo', 400],
      ['charlie', 2000],
      ['delta', 2400],
      ['echo', 5000],
      ['foxtrot', 5400],
    ])
  })

  test('an unrelated transcript still warns', async () => {
    const { engine, client } = await projectWithGappedCaptions()
    const warned = await client.callTool({ name: 'apply_captions', arguments: { transcript: unrelated, replace: true } })
    expect(textOf(warned)).toContain(
      'Warning: this transcript does not match any transcript in the project, so ensure_transcript did not produce it. ' +
        'If it did not come from a transcription provider either, undo and run ensure_transcript.',
    )
    expect(wordTimes(engine)).toEqual([
      ['quartz', 0],
      ['xylophone', 400],
    ])
  })
})
