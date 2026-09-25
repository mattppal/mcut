import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { applyCommand, createProject, EditorEngine } from '@mcut/timeline'
import { createMcutMcpServer } from './server'

test('resizeLayoutSlot reports each slot before and after, like saveLayout', async () => {
  const project = applyCommand(createProject({ width: 1920, height: 1080 }), {
    type: 'saveLayout',
    layout: {
      id: 'l-pip',
      name: 'PiP',
      slots: [
        { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
        { source: 'camera', rect: { x: 0.863, y: 0.45, w: 0.112, h: 0.5 } },
      ],
    },
  })
  const server = createMcutMcpServer({ engine: new EditorEngine({ project }) })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const result = await client.callTool({ name: 'resizeLayoutSlot', arguments: { layoutId: 'l-pip', source: 'camera', aspect: 9 / 16 } })
  const [first] = 'content' in result && Array.isArray(result.content) ? result.content : []
  const text = first?.type === 'text' ? first.text : ''

  expect(text.split('\n').slice(0, 4)).toEqual([
    'OK: resizeLayoutSlot applied.',
    'Layout "PiP" (picture-in-picture), before → after:',
    '  screen full-frame 1920×1080 px, aspect 1.78 (16:9) (unchanged)',
    '  camera overlay bottom-right 215×540 px, aspect 0.40 → camera overlay bottom-right 256×454 px, aspect 0.56 (9:16) (width +19%, height -16%)',
  ])
})
