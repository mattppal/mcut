import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, parseProject } from '@mcut/timeline'
import { createMcutMcpServer } from './server'

async function connect(engine: EditorEngine) {
  const server = createMcutMcpServer({ engine })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function contentText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = 'content' in result && Array.isArray(result.content) ? result.content : []
  const first = content[0]
  return first?.type === 'text' ? first.text : ''
}

const textProject = () =>
  parseProject({
    id: 'p-text',
    name: 'Text',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {},
    tracks: [{ id: 't-text', name: 'Text', elements: [{ id: 'e-text', type: 'text', startMs: 0, durationMs: 5000, text: 'Original' }] }],
  })

const snapshot = (engine: EditorEngine): unknown => JSON.parse(JSON.stringify(engine.toJSON()))

const fadeIn = { name: 'applyAnimationPreset', arguments: { elementId: 'e-text', preset: 'fade-in' } }

describe('transact', () => {
  test('a failing transact inside an open transaction keeps the edit that transaction holds', async () => {
    const engine = new EditorEngine({ project: textProject() })
    const client = await connect(engine)
    engine.beginTransaction()
    engine.dispatch({ type: 'updateElement', elementId: 'e-text', patch: { text: 'Typed by user' } })
    const typed = snapshot(engine)

    const failed = await client.callTool({
      name: 'transact',
      arguments: { calls: [fadeIn, { name: 'applyAnimationPreset', arguments: { elementId: 'e-missing', preset: 'fade-out' } }] },
    })
    expect(failed.isError).toBe(true)
    expect(contentText(failed)).toBe('transact call 2 (applyAnimationPreset) failed: no element "e-missing". No changes were applied.')
    expect(snapshot(engine)).toEqual(typed)

    engine.endTransaction()
    expect(engine.project.tracks[0]?.elements[0]).toMatchObject({ text: 'Typed by user' })
    expect(engine.undo()).toBe(true)
    expect(engine.project.tracks[0]?.elements[0]).toMatchObject({ text: 'Original' })
    expect(engine.canUndo()).toBe(false)
  })

  test('transact rejects undo and redo before it changes the project or the history', async () => {
    const engine = new EditorEngine({ project: textProject() })
    const client = await connect(engine)
    engine.dispatch({ type: 'updateElement', elementId: 'e-text', patch: { text: 'First' } })
    engine.dispatch({ type: 'updateElement', elementId: 'e-text', patch: { text: 'Second' } })
    engine.undo()
    const before = snapshot(engine)

    const historyCalls = [
      { call: { name: 'operator_edit_undo' }, id: 'edit.undo' },
      { call: { name: 'operator_edit_redo' }, id: 'edit.redo' },
      { call: { name: 'run_operator', arguments: { operatorId: 'edit.undo' } }, id: 'edit.undo' },
      { call: { name: 'run_action', arguments: { actionId: 'edit.redo' } }, id: 'edit.redo' },
    ]
    for (const { call, id } of historyCalls) {
      const rejected = await client.callTool({ name: 'transact', arguments: { calls: [fadeIn, call] } })
      expect(rejected.isError).toBe(true)
      expect(contentText(rejected)).toBe(
        `transact cannot run "${id}". One transact is one undo step, so it cannot contain undo or redo. Call the undo or redo tool on its own.`,
      )
      expect(snapshot(engine)).toEqual(before)
    }

    expect(engine.project.tracks[0]?.elements[0]).toMatchObject({ text: 'First' })
    expect(engine.redo()).toBe(true)
    expect(engine.project.tracks[0]?.elements[0]).toMatchObject({ text: 'Second' })
    expect(engine.undo()).toBe(true)
    expect(engine.undo()).toBe(true)
    expect(engine.project.tracks[0]?.elements[0]).toMatchObject({ text: 'Original' })
    expect(engine.canUndo()).toBe(false)
  })
})
